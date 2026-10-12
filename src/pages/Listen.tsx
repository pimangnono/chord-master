import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Note } from 'tonal';
import { noteOff, noteOn, playNotes } from '../audio/engine';
import { listAudioInputs, MicListener } from '../audio/listener';
import { connectMidi, MidiConnection } from '../audio/midi';
import { Piano } from '../components/Piano';
import { PROGRESSIONS } from '../data/progressions';
import { SONGS } from '../data/songs';
import { detectFromChroma, detectFromMidi, ChordGuess } from '../theory/detect';
import { estimateKeyFromChords } from '../theory/key';
import { keyLabel, keyUsesFlats, MAJOR_KEYS, MINOR_KEYS, movableDo } from '../theory/keys';
import { midiToNote, prettyChord, solfege } from '../theory/notes';
import { chordToRoman, parseBars, progressionToChords, secondaryLabel } from '../theory/roman';
import { buildTransitionStats, Style, suggestNext } from '../theory/suggest';
import { voiceChord } from '../theory/voicing';
import { useStore } from '../store';
import { IS_ARTIFACT } from '../platform';

type Source = 'mic' | 'midi' | 'keys';

const KEYMAP: Record<string, number> = {};
'zsxdcvgbhnjm'.split('').forEach((k, i) => (KEYMAP[k] = 48 + i));
'q2w3er5t6y7ui'.split('').forEach((k, i) => (KEYMAP[k] = 60 + i));

const STYLES: { id: Style; label: string }[] = [
  { id: 'pop', label: 'Pop' },
  { id: 'kpop', label: 'K-pop' },
  { id: 'jazz', label: 'Jazz' },
  { id: 'bossa', label: 'Bossa Nova' },
  { id: 'hiphop', label: 'Hip-hop' },
  { id: 'rnb', label: 'R&B' },
];

let statsCache: ReturnType<typeof buildTransitionStats> | null = null;
function corpusStats() {
  if (!statsCache) {
    statsCache = buildTransitionStats([
      ...PROGRESSIONS.map((p) => ({ key: p.key, chords: progressionToChords(p.numerals, p.key) })),
      ...SONGS.flatMap((s) => s.sections.map((sec) => ({ key: s.key, chords: parseBars(sec.chords) }))),
    ]);
  }
  return statsCache;
}

export function ListenPage() {
  const [source, setSource] = useState<Source>('keys');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState(0.5);
  const [keyMode, setKeyMode] = useState<string>('auto');
  const [style, setStyle] = useState<Style>('pop');
  const [level, setLevel] = useState(0);
  const [notes, setNotes] = useState<number[]>([]);
  const [bassMidi, setBassMidi] = useState<number | undefined>();
  const [current, setCurrent] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ChordGuess[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [midiSound, setMidiSound] = useState(false);
  const [estKey, setEstKey] = useState<string | null>(null);
  const saveProgression = useStore((s) => s.saveProgression);
  const [saved, setSaved] = useState(false);

  const listener = useRef<MicListener | null>(null);
  const midi = useRef<MidiConnection | null>(null);
  const raf = useRef(0);
  const held = useRef(new Set<number>());
  const recent = useRef<string[]>([]);
  const currentRef = useRef<string | null>(null);
  const settle = useRef<number | undefined>(undefined);

  const key = keyMode === 'auto' ? estKey ?? 'C' : keyMode;
  const flats = keyUsesFlats(key);
  const flatsRef = useRef(flats);
  flatsRef.current = flats;

  const commit = useCallback((symbol: string) => {
    if (currentRef.current === symbol) return;
    currentRef.current = symbol;
    setCurrent(symbol);
    setHistory((h) => (h[h.length - 1] === symbol ? h : [...h, symbol].slice(-24)));
    recent.current = [...recent.current, symbol].slice(-12);
    const guess = estimateKeyFromChords(recent.current)[0];
    if (guess) setEstKey(guess.key);
  }, []);

  // ── note-based sources (MIDI / on-screen / computer keyboard) ──
  const evaluateHeld = useCallback(() => {
    const ms = [...held.current].sort((a, b) => a - b);
    setNotes(ms);
    setBassMidi(ms[0]);
    clearTimeout(settle.current);
    if (ms.length < 2) return;
    settle.current = window.setTimeout(() => {
      const g = detectFromMidi(ms, flatsRef.current);
      setCandidates(g.slice(0, 3));
      if (g[0]) commit(g[0].symbol);
    }, 90);
  }, [commit]);

  const pressNote = useCallback(
    (m: number, sound: boolean) => {
      held.current.add(m);
      if (sound) noteOn(midiToNote(m));
      evaluateHeld();
    },
    [evaluateHeld],
  );
  const releaseNote = useCallback(
    (m: number, sound: boolean) => {
      held.current.delete(m);
      if (sound) noteOff(midiToNote(m));
      evaluateHeld();
    },
    [evaluateHeld],
  );

  useEffect(() => {
    if (source !== 'keys') return;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const m = KEYMAP[e.key.toLowerCase()];
      if (m !== undefined) pressNote(m, true);
    };
    const up = (e: KeyboardEvent) => {
      const m = KEYMAP[e.key.toLowerCase()];
      if (m !== undefined) releaseNote(m, true);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [source, pressNote, releaseNote]);

  // ── microphone ──
  const micLoop = useCallback(() => {
    const ema = new Array(12).fill(0);
    let lastLevel = 0;
    let cand = '';
    let count = 0;
    let frame = 0;
    let silent = 0;
    const tick = () => {
      const l = listener.current;
      if (!l) return;
      const f = l.analyze(sensRef.current);
      frame++;
      if (f) {
        if (!f.notes.length) {
          for (let i = 0; i < 12; i++) ema[i] *= 0.8;
          silent++;
        } else {
          silent = 0;
          const onset = f.level > lastLevel * 1.5 + 0.03;
          for (let i = 0; i < 12; i++) ema[i] = onset ? f.chroma[i] : ema[i] * 0.55 + f.chroma[i] * 0.45;
          const guesses = detectFromChroma(ema, f.bass !== undefined ? f.bass % 12 : undefined, flatsRef.current);
          const top = guesses[0];
          if (top && top.score > 0.78 && f.notes.length >= 2) {
            if (top.symbol === cand) count++;
            else {
              cand = top.symbol;
              count = 1;
            }
            if (count >= 3) commit(top.symbol);
          }
          if (frame % 3 === 0) setCandidates(guesses);
        }
        lastLevel = f.level;
        if (frame % 3 === 0) {
          setLevel(f.level);
          setNotes(f.notes.map((n) => n.midi).sort((a, b) => a - b));
          setBassMidi(f.bass);
          if (silent > 30) setCandidates([]);
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [commit]);
  const sensRef = useRef(sensitivity);
  sensRef.current = sensitivity;

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    listener.current?.stop();
    listener.current = null;
    midi.current?.disconnect();
    midi.current = null;
    held.current.clear();
    setRunning(false);
    setLevel(0);
    setNotes([]);
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    setError(null);
    try {
      if (source === 'mic') {
        const l = new MicListener();
        await l.start(deviceId || undefined);
        listener.current = l;
        listAudioInputs().then(setDevices);
        micLoop();
      } else if (source === 'midi') {
        midi.current = await connectMidi(
          (type, note) => (type === 'on' ? pressNote(note, midiSoundRef.current) : releaseNote(note, midiSoundRef.current)),
          setMidiInputs,
        );
        setMidiInputs(midi.current.inputs);
      }
      setRunning(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(source === 'mic' ? `마이크를 사용할 수 없어요: ${msg}` : msg);
      stop();
    }
  };
  const midiSoundRef = useRef(midiSound);
  midiSoundRef.current = midiSound;

  const switchSource = (s: Source) => {
    stop();
    setSource(s);
    setCandidates([]);
  };

  const stats = useMemo(() => corpusStats(), []);
  const suggestions = useMemo(() => (current ? suggestNext(current, key, { style, stats, limit: 6 }) : []), [current, key, style, stats]);

  const marks = new Map<number, 'active' | 'root' | 'hint'>();
  if (hint) {
    const v = voiceChord(hint);
    [v.bass, ...v.rh].forEach((n) => marks.set(Note.midi(n)!, 'hint'));
  }
  notes.forEach((m) => marks.set(m, 'active'));
  if (bassMidi !== undefined && notes.includes(bassMidi)) marks.set(bassMidi, 'root');

  const saveHistory = () => {
    if (history.length < 2) return;
    saveProgression({
      name: `연주 기록 ${new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      key,
      chords: history.map((symbol) => ({ symbol, beats: 4 })),
      bpm: 90,
      rhythm: 'whole',
      source: '실시간 코드 인식',
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>실시간 코드 인식</h1>
        <p className="muted">피아노를 치면 지금 코드를 알아내고, 다음에 올 수 있는 코드를 추천해요.</p>
      </header>

      <div className="card listen-controls">
        <div className="seg big">
          <button className={source === 'mic' ? 'on' : ''} onClick={() => switchSource('mic')} disabled={IS_ARTIFACT}>
            🎙️ 마이크 (어쿠스틱 피아노)
          </button>
          <button className={source === 'midi' ? 'on' : ''} onClick={() => switchSource('midi')} disabled={IS_ARTIFACT}>
            🎹 MIDI (디지털 피아노)
          </button>
          <button className={source === 'keys' ? 'on' : ''} onClick={() => switchSource('keys')}>
            ⌨️ 화면·키보드 건반
          </button>
        </div>
        <div className="row gap wrap">
          {source !== 'keys' &&
            (running ? (
              <button className="btn play on" onClick={stop}>
                ■ 듣기 중지
              </button>
            ) : (
              <button className="btn play" onClick={start}>
                ● 듣기 시작
              </button>
            ))}
          {source === 'mic' && (
            <>
              <label className="field grow">
                <span>민감도 {Math.round(sensitivity * 100)}%</span>
                <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(+e.target.value)} />
              </label>
              {devices.length > 1 && (
                <label className="field">
                  <span>입력 장치</span>
                  <select
                    value={deviceId}
                    onChange={(e) => {
                      setDeviceId(e.target.value);
                      stop();
                    }}
                  >
                    <option value="">기본 마이크</option>
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || '마이크'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="meter" title="입력 레벨">
                <div style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
            </>
          )}
          {source === 'midi' && (
            <>
              <button className={`chip-toggle${midiSound ? ' on' : ''}`} onClick={() => setMidiSound((x) => !x)}>
                앱에서도 소리 내기
              </button>
              <span className="muted small">{running ? (midiInputs.length ? `연결됨: ${midiInputs.join(', ')}` : 'MIDI 장치를 연결해 주세요 (USB/블루투스)') : ''}</span>
            </>
          )}
          {source === 'keys' && <span className="muted small">아래 건반을 클릭하거나 키보드로 연주: 아랫줄 Z S X D C V… (도3~), 윗줄 Q 2 W 3 E R… (도4~)</span>}
          <label className="field">
            <span>조성</span>
            <select value={keyMode} onChange={(e) => setKeyMode(e.target.value)}>
              <option value="auto">자동 추정{estKey ? ` (${estKey})` : ''}</option>
              {[...MAJOR_KEYS, ...MINOR_KEYS].map((k) => (
                <option key={k} value={k}>
                  {keyLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>추천 스타일</span>
            <select value={style} onChange={(e) => setStyle(e.target.value as Style)}>
              {STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {IS_ARTIFACT && (
          <p className="notice">
            이 claude.ai 링크에서는 보안 정책상 마이크와 MIDI를 쓸 수 없어요. 화면 건반이나 컴퓨터 키보드로 코드를 눌러 보세요. 내 피아노 소리로 인식하려면 앱을 컴퓨터에서 직접 실행(<code>npm run dev</code>)하면 돼요.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {source === 'mic' && !running && (
          <p className="muted small">
            팁: 피아노 가까이에서, 조용한 곳에서 코드를 또렷하게 눌러 주세요. 코드를 바꿀 때 페달을 떼면 인식이 빨라져요. 블루투스 이어폰 마이크보다 노트북/폰 내장 마이크가 더 정확해요.
          </p>
        )}
      </div>

      <div className="listen-main">
        <section className="card now">
          <span className="muted small">지금 코드</span>
          <div className="now-chord">{current ? prettyChord(current) : '—'}</div>
          {current && (
            <div className="now-meta">
              <span className="pill">{chordToRoman(current, key)}</span>
              {secondaryLabel(current, key) && <span className="pill alt">{secondaryLabel(current, key)}</span>}
              <span className="muted">in {keyLabel(key)}</span>
            </div>
          )}
          <div className="now-notes">
            {notes.map((m) => (
              <span key={m} className={m === bassMidi ? 'bass' : ''}>
                {solfege(midiToNote(m, flats))}
                <i title="이동도법">{movableDo(midiToNote(m, flats), key)}</i>
                <small>{midiToNote(m, flats)}</small>
              </span>
            ))}
          </div>
          {candidates.length > 1 && (
            <div className="cands">
              다른 후보:{' '}
              {candidates.slice(1, 3).map((c) => (
                <button key={c.symbol} className="link" onClick={() => commit(c.symbol)}>
                  {prettyChord(c.symbol)}
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="card next">
          <h3>다음에 올 수 있는 코드</h3>
          {!current && <p className="muted">코드를 연주하면 추천이 나타나요.</p>}
          <div className="sugg-list">
            {suggestions.map((s) => (
              <button
                key={s.symbol}
                className="sugg"
                onMouseEnter={() => setHint(s.symbol)}
                onMouseLeave={() => setHint(null)}
                onClick={() => {
                  const v = voiceChord(s.symbol);
                  playNotes([v.bass, ...v.rh], 1.5);
                }}
              >
                <div className="sugg-top">
                  <b>{prettyChord(s.symbol)}</b>
                  <span className="pill">{s.numeral}</span>
                </div>
                <div className="sugg-bar">
                  <div style={{ width: `${Math.min(100, Math.round(s.score * 90))}%` }} />
                </div>
                <ul>
                  {s.reasons.slice(0, 2).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
        </section>
      </div>

      <Piano
        from={36}
        to={96}
        height={130}
        marks={marks}
        preferFlats={flats}
        keyName={key}
        onDown={
          source === 'keys'
            ? (m) => {
                // mouse clicks latch notes so a whole chord can be built one key at a time
                if (held.current.has(m)) releaseNote(m, false);
                else {
                  playNotes([midiToNote(m)], 1);
                  pressNote(m, false);
                }
              }
            : (m) => playNotes([midiToNote(m)], 1)
        }
      />
      {source === 'keys' && (
        <div className="row gap">
          <span className="muted small">건반을 클릭하면 눌린 상태로 유지돼요. 다시 클릭하면 떼어져요.</span>
          <button
            className="btn ghost"
            onClick={() => {
              const ms = notes.map((m) => midiToNote(m));
              if (ms.length) playNotes(ms, 1.5);
            }}
          >
            ▶ 눌린 음 듣기
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              held.current.clear();
              evaluateHeld();
            }}
          >
            모두 떼기
          </button>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h3>연주 기록</h3>
          <div className="row gap">
            <button className="btn ghost" disabled={history.length < 2} onClick={saveHistory}>
              {saved ? '저장됨 ✓' : '♥ 진행으로 저장'}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setHistory([]);
                recent.current = [];
                setEstKey(null);
              }}
            >
              지우기
            </button>
          </div>
        </div>
        <div className="history">
          {history.length === 0 && <span className="muted">인식된 코드가 여기에 쌓여요.</span>}
          {history.map((h, i) => (
            <button key={i} className="chord-chip small" onClick={() => playNotes([voiceChord(h).bass, ...voiceChord(h).rh], 1.4)}>
              <span className="chord-name">{prettyChord(h)}</span>
              <span className="chord-roman">{chordToRoman(h, key)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
