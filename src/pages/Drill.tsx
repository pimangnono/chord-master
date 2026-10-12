import { useEffect, useMemo, useRef, useState } from 'react';
import { Note } from 'tonal';
import { playNotes } from '../audio/engine';
import { connectMidiHub, useMidi } from '../audio/midiHub';
import { PlayedChord, useChordInput } from '../audio/useChordInput';
import { Piano } from '../components/Piano';
import { corpusStats } from '../data/corpus';
import { newSeed, seededRng } from '../game/stages';
import { IS_ARTIFACT } from '../platform';
import { chordMatches, detectFromMidi } from '../theory/detect';
import { DrillChord, DrillRange, historyToProgression, InversionMode, nextDrillChord, pickInversion, tonicChord } from '../theory/drill';
import { playedInversion, InversionTarget } from '../theory/inversion';
import { keyLabel, keyUsesFlats, MAJOR_KEYS, MINOR_KEYS, movableDo } from '../theory/keys';
import { midiToNote, prettyChord, prettyNote, solfege } from '../theory/notes';
import type { Style } from '../theory/suggest';
import { voiceChord } from '../theory/voicing';
import { useStore } from '../store';

const STYLES: { id: Style; label: string }[] = [
  { id: 'pop', label: 'Pop' },
  { id: 'kpop', label: 'K-pop' },
  { id: 'jazz', label: 'Jazz' },
  { id: 'bossa', label: 'Bossa Nova' },
  { id: 'hiphop', label: 'Hip-hop' },
  { id: 'rnb', label: 'R&B' },
];

const INV_MODES: { id: InversionMode; label: string; help: string }[] = [
  { id: 'free', label: '자유', help: '어떤 자리바꿈이든 코드만 맞으면 통과' },
  { id: 'random', label: '지정 자리바꿈', help: '매번 기본형·1전위·2전위(·3전위) 중 하나를 정해줘요' },
  { id: 'smooth', label: '이어치기', help: '방금 친 코드에서 손이 가장 적게 움직이는 자리로 — 보이스 리딩 연습' },
];

const FN_LABEL: Record<string, string> = { T: '토닉', S: '서브도미넌트', D: '도미넌트', SD: '부속 도미넌트', B: '빌린 화음', '?': '' };

interface Played {
  chord: DrillChord;
  notes: number[];
  ms: number;
  clean: boolean;
}

export function DrillPage() {
  const [key, setKey] = useState('C');
  const [style, setStyle] = useState<Style>('pop');
  const [range, setRange] = useState<DrillRange>('diatonic');
  const [invMode, setInvMode] = useState<InversionMode>('smooth');
  const [showHint, setShowHint] = useState(false);
  const recordGame = useStore((s) => s.recordGame);
  const saveProgression = useStore((s) => s.saveProgression);
  const midi = useMidi();

  const rng = useRef(seededRng(newSeed()));
  const [current, setCurrent] = useState<DrillChord>(() => tonicChord('C', 'pop'));
  const [target, setTarget] = useState<InversionTarget | null>(null);
  const [trail, setTrail] = useState<Played[]>([]);
  const [wrong, setWrong] = useState<{ label: string; why: string } | null>(null);
  const [misses, setMisses] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [saved, setSaved] = useState(false);
  const shownAt = useRef(performance.now());
  const latch = useRef(new Set<number>());
  const [latchView, setLatchView] = useState<number[]>([]);
  const xpRef = useRef(0);

  const opts = useMemo(() => ({ key, style, range, stats: corpusStats() }), [key, style, range]);
  const flats = keyUsesFlats(key);

  const restart = () => {
    const first = tonicChord(key, style);
    setCurrent(first);
    setTarget(pickInversion(first.symbol, invMode, undefined, rng.current));
    setTrail([]);
    setWrong(null);
    setMisses(0);
    setStreak(0);
    setSaved(false);
    shownAt.current = performance.now();
  };
  // a new key, style, range or inversion mode starts a fresh phrase
  useEffect(restart, [key, style, range, invMode]);

  // award XP for the session when leaving the page
  useEffect(
    () => () => {
      if (xpRef.current > 0) recordGame('drill', 0, xpRef.current, 0);
    },
    [recordGame],
  );

  const submit = (c: PlayedChord) => {
    if (!chordMatches(c.notes, current.symbol)) {
      setWrong({ label: c.label, why: '다른 코드예요' });
      setMisses((m) => m + 1);
      setStreak(0);
      return;
    }
    if (target && playedInversion(c.notes, current.symbol) !== target.number) {
      const got = playedInversion(c.notes, current.symbol);
      setWrong({ label: c.label, why: `코드는 맞았는데 ${got >= 0 ? ['기본형', '1전위', '2전위', '3전위'][got] : '다른 자리'}로 쳤어요 — ${target.name}로 쳐 보세요` });
      setMisses((m) => m + 1);
      setStreak(0);
      return;
    }
    if (c.source === 'screen') playNotes(c.notes.map((m) => midiToNote(m)), 1.2);
    const clean = !wrong;
    const ms = performance.now() - shownAt.current;
    const entry: Played = { chord: current, notes: c.notes, ms, clean };
    const nextTrail = [...trail, entry];
    setTrail(nextTrail);
    setStreak((s) => {
      const n = clean ? s + 1 : 0;
      setBest((b) => Math.max(b, n));
      return n;
    });
    xpRef.current += clean ? 3 : 1;
    const history = nextTrail.map((p) => p.chord.symbol);
    const next = nextDrillChord(current, history, nextTrail.length, opts, rng.current);
    setCurrent(next);
    setTarget(pickInversion(next.symbol, invMode, c.notes, rng.current));
    setWrong(null);
    setShowHint(false);
    setSaved(false);
    shownAt.current = performance.now();
  };

  const input = useChordInput(true, submit);

  // the voicing to show as a hint: smooth from the last chord, in the required inversion if any
  const hintNotes = useMemo(() => {
    const prev = trail.at(-1)?.notes.map((m) => Note.fromMidi(m));
    const v = voiceChord(current.symbol, prev);
    let rh = v.rh.map((n) => Note.midi(n)!);
    if (target) {
      const bass = Note.chroma(target.bass)!;
      for (let k = 0; k < rh.length && rh[0] % 12 !== bass; k++) rh = [...rh.slice(1), rh[0] + 12];
      while (rh[0] > 67) rh = rh.map((m) => m - 12);
    }
    return rh;
  }, [current, target, trail]);

  const marks = new Map<number, 'hint' | 'active'>();
  if (showHint) hintNotes.forEach((m) => marks.set(m, 'hint'));
  latchView.forEach((m) => marks.set(m, 'active'));

  const done = trail.length;
  const clean = trail.filter((t) => t.clean).length;
  const avgMs = done ? trail.reduce((a, t) => a + t.ms, 0) / done : 0;
  const lastPlayed = trail.at(-1);
  const midiChord = midi.held.length >= 2 ? detectFromMidi(midi.held, flats)[0]?.symbol : undefined;

  return (
    <div className="page">
      <header className="page-head">
        <h1>코드 복습</h1>
        <p className="muted">
          화성학 규칙에 따라 자연스럽게 이어지는 코드가 하나씩 나와요. 피아노로 맞게 치면 다음 코드가 나타나요. 8개마다 도미넌트 → 으뜸화음으로 마무리되는 프레이즈가 만들어져요.
        </p>
      </header>

      <div className="card drill-settings">
        <label className="field">
          <span>조성</span>
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            {[...MAJOR_KEYS, ...MINOR_KEYS].map((k) => (
              <option key={k} value={k}>
                {keyLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>스타일</span>
          <select value={style} onChange={(e) => setStyle(e.target.value as Style)}>
            {STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>코드 범위</span>
          <div className="seg">
            <button className={range === 'diatonic' ? 'on' : ''} onClick={() => setRange('diatonic')}>
              다이아토닉
            </button>
            <button className={range === 'color' ? 'on' : ''} onClick={() => setRange('color')}>
              + 부속·빌린 화음
            </button>
          </div>
        </div>
        <div className="field">
          <span>자리바꿈 연습</span>
          <div className="seg">
            {INV_MODES.map((m) => (
              <button key={m.id} className={invMode === m.id ? 'on' : ''} onClick={() => setInvMode(m.id)} title={m.help}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="play-inputs">
          {midi.status === 'on' ? (
            <span className="pill ok-pill">🎹 MIDI 연결됨</span>
          ) : midi.status !== 'unsupported' ? (
            <button className="btn small" onClick={() => connectMidiHub(true)}>
              🎹 MIDI 피아노 연결
            </button>
          ) : null}
          {!IS_ARTIFACT &&
            (input.micOn ? (
              <button className="btn small ghost" onClick={input.stopMic}>
                🎙️ 듣는 중{input.hearing ? ` · ${prettyChord(input.hearing)}` : ''} (끄기)
              </button>
            ) : (
              <button className="btn small ghost" onClick={input.startMic}>
                🎙️ 마이크로 듣기
              </button>
            ))}
        </div>
      </div>
      <p className="muted small">{INV_MODES.find((m) => m.id === invMode)!.help}. 자리바꿈은 가장 낮은 음으로 판단해요 — 한 손으로 치거나, 왼손을 쓸 땐 왼손 음이 그 음이 되게 쳐 주세요.</p>
      {input.micError && <p className="error small">{input.micError}</p>}

      <div className="drill-main">
        <section className="card drill-now">
          <span className="muted small">
            {done + 1}번째 코드 · 프레이즈 {Math.floor(done / 8) + 1} — {(done % 8) + 1}/8
          </span>
          <div className="drill-chord">{prettyChord(current.symbol)}</div>
          <div className="now-meta">
            <span className="pill">{current.numeral}</span>
            {FN_LABEL[current.fn.code] && <span className={`fn fn-${current.fn.code}`}>{FN_LABEL[current.fn.code]}</span>}
            <span className="muted">in {keyLabel(key)}</span>
          </div>
          {target && (
            <div className="drill-inv">
              <b>{target.name}</b>
              <span>
                {target.role} <b>{solfege(target.bass)}</b>
                <small>
                  ({prettyNote(target.bass)} · 이동도 {movableDo(target.bass, key)})
                </small>
                를 가장 아래에
              </span>
            </div>
          )}
          <p className="drill-reason">💡 {current.reason}</p>
          <div className={`play-feedback${wrong ? ' bad' : lastPlayed ? ' ok' : ''}`}>
            {wrong ? (
              <>
                방금 친 코드: <b>{prettyChord(wrong.label)}</b> — {wrong.why}
              </>
            ) : lastPlayed ? (
              <>✔ {prettyChord(lastPlayed.chord.symbol)} 좋아요! ({(lastPlayed.ms / 1000).toFixed(1)}초)</>
            ) : (
              <span className="muted">피아노로 이 코드를 쳐 보세요</span>
            )}
          </div>
          <div className="row gap wrap center">
            <button className="btn small ghost" onClick={() => setShowHint((h) => !h)}>
              💡 {showHint ? '힌트 숨기기' : '건반 힌트'}
            </button>
            <button className="btn small ghost" onClick={() => playNotes(hintNotes.map((m) => midiToNote(m)), 1.4)}>
              🔊 들어보기
            </button>
            <button className="btn small ghost" onClick={restart}>
              ↺ 처음부터
            </button>
          </div>
          {midi.status === 'on' && <span className="muted small">지금 누른 코드: {midiChord ? prettyChord(midiChord) : '—'}</span>}
        </section>

        <section className="card drill-stats">
          <div className="review-stats">
            <div>
              <b>{done}</b>
              <span>맞힌 코드</span>
            </div>
            <div>
              <b>{done ? Math.round((clean / (done + misses)) * 100) : 0}%</b>
              <span>한 번에 맞힘</span>
            </div>
            <div>
              <b>🔥 {streak}</b>
              <span>연속 (최고 {best})</span>
            </div>
            <div>
              <b>{done ? (avgMs / 1000).toFixed(1) : '–'}s</b>
              <span>평균 반응</span>
            </div>
          </div>
          <h4>지금까지의 진행</h4>
          <div className="drill-trail">
            {trail.length === 0 && <span className="muted small">친 코드가 여기에 진행으로 쌓여요.</span>}
            {trail.map((t, i) => (
              <span key={i} className={`drill-step${t.clean ? '' : ' retry'}${i % 8 === 7 ? ' phrase-end' : ''}`}>
                <b>{prettyChord(t.chord.symbol)}</b>
                <small>{t.chord.numeral}</small>
              </span>
            ))}
          </div>
          {trail.length >= 4 && (
            <button
              className="btn small ghost"
              onClick={() => {
                saveProgression({ name: `코드 복습 ${new Date().toLocaleDateString('ko-KR')}`, key, chords: historyToProgression(trail.slice(-16).map((t) => t.chord.symbol)), bpm: 90, rhythm: 'whole', source: '코드 복습' });
                setSaved(true);
              }}
            >
              {saved ? '저장됨 ✓' : '♥ 최근 16코드를 진행으로 저장'}
            </button>
          )}
        </section>
      </div>

      <Piano
        from={36}
        to={84}
        height={130}
        marks={marks}
        preferFlats={flats}
        keyName={key}
        onDown={(m) => {
          const s = latch.current;
          if (s.has(m)) s.delete(m);
          else s.add(m);
          setLatchView([...s].sort((a, b) => a - b));
        }}
      />
      <div className="row gap wrap">
        <span className="muted small">화면 건반: 음을 고른 뒤 버튼으로 내기</span>
        <button
          className="btn small"
          disabled={latchView.length < 2}
          onClick={() => {
            submit({ notes: latchView, label: detectFromMidi(latchView, flats)[0]?.symbol ?? '?', source: 'screen' });
            latch.current.clear();
            setLatchView([]);
          }}
        >
          이 코드 내기
        </button>
      </div>
    </div>
  );
}
