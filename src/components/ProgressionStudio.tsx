import { useEffect, useMemo, useState } from 'react';
import { Note } from 'tonal';
import { player, playNotes } from '../audio/engine';
import { startPlayback, stopPlayback, useAudioStatus, usePlayback } from '../audio/playback';
import type { GenreId } from '../data/progressions';
import { GENRE_BY_ID } from '../data/progressions';
import { getRhythm, RHYTHMS } from '../data/rhythms';
import { intervalBetweenKeys, keyLabel, keyOptionsFor, keyUsesFlats, parseKey, transposeChord } from '../theory/keys';
import { prettyChord } from '../theory/notes';
import { ChordEvent, chordToRoman, secondaryLabel } from '../theory/roman';
import { BassSuggestion, bassSuggestions } from '../theory/inversion';
import { convertMode, parallelKey } from '../theory/mode';
import { noteRole, voiceProgression, VoicingMode } from '../theory/voicing';
import { InversionGuide } from './InversionGuide';
import { buildFollowSteps, Hands } from '../notation/score';
import { buildArrangement } from '../theory/arrange';
import { connectMidiHub, useMidi } from '../audio/midiHub';
import { timingLabel, useFollow } from './useFollow';
import { useStore } from '../store';
import { Piano } from './Piano';
import { RhythmGrid } from './RhythmGrid';
import { SheetMusic } from './SheetMusic';

export interface StudioProps {
  owner: string;
  title: string;
  chords: ChordEvent[];
  baseKey: string;
  bpm: number;
  rhythm: string;
  genre?: GenreId;
  source?: string;
  /** controlled rhythm (e.g. song practice steps) */
  onRhythmChange?: (id: string) => void;
}

export function shortRole(role?: string) {
  if (!role) return '';
  return (
    {
      근음: 'R',
      장3음: '3',
      단3음: '♭3',
      장7음: '7',
      단7음: '♭7',
      감7음: '𝄫7',
      베이스음: 'B',
      비화성음: '·',
    }[role] ?? role.replace('음', '')
  );
}

export function ProgressionStudio({ owner, title, chords: inputChords, baseKey: inputKey, bpm: initialBpm, rhythm: initialRhythm, genre, source, onRhythmChange }: StudioProps) {
  const [key, setKey] = useState(inputKey);
  /** true = play the progression in the parallel mode (장조 ↔ 단조) */
  const [flip, setFlip] = useState(false);
  const converted = useMemo(() => convertMode(inputChords, inputKey), [inputChords, inputKey]);
  const chords = flip ? converted.chords : inputChords;
  const baseKey = flip ? converted.key : inputKey;
  const inputMinor = parseKey(inputKey).minor;
  const [rhythmId, setRhythmId] = useState(initialRhythm);
  const [bpm, setBpm] = useState(initialBpm);
  const [loop, setLoop] = useState(true);
  const [drums, setDrums] = useState(true);
  const [muteLH, setMuteLH] = useState(false);
  const [muteRH, setMuteRH] = useState(false);
  const [view, setView] = useState<'accomp' | 'voicing'>('accomp');
  const [voicingMode, setVoicingMode] = useState<VoicingMode>('smooth');
  /** chord index → slash-chord replacement from the inversion guide */
  const [slashes, setSlashes] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState(title);
  const [toast, setToast] = useState<string | null>(null);
  const saveProgression = useStore((s) => s.saveProgression);
  const playback = usePlayback();
  const audio = useAudioStatus();
  const isPlaying = playback.owner === owner;

  useEffect(() => {
    setKey(inputKey);
    setFlip(false);
  }, [inputKey, inputChords]);
  useEffect(() => setRhythmId(initialRhythm), [initialRhythm]);
  useEffect(() => setBpm(initialBpm), [initialBpm]);
  useEffect(() => setSaveName(title), [title]);
  useEffect(() => () => {
    if (usePlayback.getState().owner === owner) stopPlayback();
  }, [owner]);

  const rhythm = getRhythm(rhythmId);
  const ivl = intervalBetweenKeys(baseKey, key);
  const keyedBase = useMemo(() => chords.map((c) => ({ ...c, symbol: transposeChord(c.symbol, ivl) })), [chords, ivl]);
  useEffect(() => setSlashes({}), [keyedBase]);
  const keyed = useMemo(() => keyedBase.map((c, i) => (slashes[i] ? { ...c, symbol: slashes[i] } : c)), [keyedBase, slashes]);
  const bassSugg = useMemo(() => bassSuggestions(keyedBase.map((c) => c.symbol)), [keyedBase]);
  const voicings = useMemo(() => voiceProgression(keyed.map((c) => c.symbol), voicingMode), [keyed, voicingMode]);
  const flats = keyUsesFlats(key);
  const current = isPlaying && playback.chord >= 0 ? playback.chord : selected;
  const v = voicings[current];

  // ── 따라치기 (wait-mode practice on the score) ──
  const [hands, setHands] = useState<Hands>('rh');
  const [octaveFree, setOctaveFree] = useState(false);
  const [showKeys, setShowKeys] = useState(true);
  const sheetRhythm = view === 'accomp' ? rhythm : getRhythm('whole');
  const followSteps = useMemo(() => buildFollowSteps(buildArrangement(keyed, sheetRhythm, voicingMode), hands), [keyed, sheetRhythm, voicingMode, hands]);
  const follow = useFollow(followSteps, bpm, octaveFree);
  const midiStatus = useMidi((s) => s.status);

  type Settings = { key: string; rhythm: string; loop: boolean; drums: boolean; muteLH: boolean; muteRH: boolean; voicing: VoicingMode; slashes: Record<number, string>; flip: boolean };
  const restart = (patch: Partial<Settings>) => {
    if (!isPlaying) return;
    const next: Settings = { key, rhythm: rhythmId, loop, drums, muteLH, muteRH, voicing: voicingMode, slashes, flip, ...patch };
    const src = next.flip ? converted : { key: inputKey, chords: inputChords };
    const iv = intervalBetweenKeys(src.key, next.key);
    startPlayback(owner, {
      chords: src.chords.map((c, i) => ({ ...c, symbol: next.slashes[i] ?? transposeChord(c.symbol, iv) })),
      rhythm: getRhythm(next.rhythm),
      bpm,
      loop: next.loop,
      drums: next.drums,
      muteLH: next.muteLH,
      muteRH: next.muteRH,
      voicing: next.voicing,
    });
  };

  const toggle = () => {
    if (isPlaying) stopPlayback();
    else startPlayback(owner, { chords: keyed, rhythm, bpm, loop, drums, muteLH, muteRH, voicing: voicingMode });
  };

  const changeMode = (toFlip: boolean) => {
    if (toFlip === flip) return;
    const nextKey = parallelKey(key);
    setFlip(toFlip);
    setKey(nextKey);
    restart({ flip: toFlip, key: nextKey, slashes: {} });
  };

  const changeVoicing = (m: VoicingMode) => {
    setVoicingMode(m);
    restart({ voicing: m });
  };

  const toggleSlash = (sg: BassSuggestion) => {
    const next = { ...slashes };
    if (next[sg.index] === sg.symbol) delete next[sg.index];
    else next[sg.index] = sg.symbol;
    setSlashes(next);
    setSelected(sg.index);
    restart({ slashes: next });
  };

  const changeRhythm = (id: string) => {
    setRhythmId(id);
    onRhythmChange?.(id);
    restart({ rhythm: id });
  };

  const changeBpm = (n: number) => {
    setBpm(n);
    if (isPlaying) player.setBpm(n);
  };

  const doSave = () => {
    saveProgression({ name: saveName || title, key, chords: keyed, bpm, rhythm: rhythmId, source });
    setSaving(false);
    setToast('내 라이브러리에 저장했어요 ♥');
    setTimeout(() => setToast(null), 2200);
  };

  const followMarks = new Map<number, 'active' | 'root' | 'hint' | 'wrong'>();
  if (follow.active && follow.current && showKeys) for (const m of follow.current.notes) followMarks.set(m, follow.isDue ? 'root' : 'hint');
  if (follow.wrongNote !== null) followMarks.set(follow.wrongNote, 'wrong');

  const recommended = genre ? GENRE_BY_ID[genre].rhythms : [];
  const sortedRhythms = [...RHYTHMS].sort((a, b) => Number(recommended.includes(b.id)) - Number(recommended.includes(a.id)));
  const marks = new Map<number, 'active' | 'root'>();
  const captions = new Map<number, string>();
  if (v) {
    for (const n of v.rh) {
      const m = Note.midi(n)!;
      marks.set(m, 'active');
      captions.set(m, shortRole(noteRole(n, v.symbol)));
    }
    const b = Note.midi(v.bass)!;
    marks.set(b, 'root');
    captions.set(b, shortRole(noteRole(v.bass, v.symbol)));
  }

  return (
    <div className="studio">
      <div className="studio-bar">
        <button className={`btn play${isPlaying ? ' on' : ''}`} onClick={toggle} disabled={audio === 'loading' && !isPlaying}>
          {isPlaying ? '■ 정지' : audio === 'loading' ? '피아노 불러오는 중…' : '▶ 재생'}
        </button>
        <label className="field">
          <span>조성</span>
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              restart({ key: e.target.value, slashes: {} });
            }}
          >
            {keyOptionsFor(parseKey(baseKey).minor).map((k) => (
              <option key={k} value={k}>
                {keyLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>장조 · 단조</span>
          <div className="seg">
            <button className={!flip ? 'on' : ''} onClick={() => changeMode(false)} title="원래 조성">
              {inputMinor ? '단조' : '장조'} (원곡)
            </button>
            <button className={flip ? 'on' : ''} onClick={() => changeMode(true)} title="같은 으뜸음의 다른 조로 바꿔요 (예: C장조 ↔ C단조)">
              {inputMinor ? '장조로' : '단조로'} 바꾸기
            </button>
          </div>
        </div>
        <label className="field">
          <span>반주 리듬</span>
          <select value={rhythmId} onChange={(e) => changeRhythm(e.target.value)}>
            {sortedRhythms.map((r) => (
              <option key={r.id} value={r.id}>
                {recommended.includes(r.id) ? '★ ' : ''}
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>템포 {bpm} BPM</span>
          <input type="range" min={40} max={200} value={bpm} onChange={(e) => changeBpm(+e.target.value)} />
        </label>
        <div className="toggles">
          {(
            [
              ['반복', loop, (x: boolean) => (setLoop(x), restart({ loop: x }))],
              ['드럼', drums, (x: boolean) => (setDrums(x), restart({ drums: x }))],
              ['왼손', !muteLH, (x: boolean) => (setMuteLH(!x), restart({ muteLH: !x }))],
              ['오른손', !muteRH, (x: boolean) => (setMuteRH(!x), restart({ muteRH: !x }))],
            ] as [string, boolean, (x: boolean) => void][]
          ).map(([label, on, set]) => (
            <button key={label} className={`chip-toggle${on ? ' on' : ''}`} onClick={() => set(!on)}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={() => setSaving((s) => !s)}>
          ♥ 저장
        </button>
      </div>
      {saving && (
        <div className="save-row">
          <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="진행 이름" autoFocus onKeyDown={(e) => e.key === 'Enter' && doSave()} />
          <button className="btn" onClick={doSave}>
            라이브러리에 저장
          </button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {flip && (
        <p className="notice">
          {inputMinor
            ? '단조 진행을 같은 으뜸음의 장조로 바꿨어요. 음계의 3·6·7음이 반음씩 올라가서(예: 미♭→미, 라♭→라, 시♭→시) 밝은 분위기가 돼요.'
            : '장조 진행을 같은 으뜸음의 단조로 바꿨어요. 음계의 3·6·7음이 반음씩 내려가서(예: 미→미♭, 라→라♭, 시→시♭) 어두운 분위기가 돼요. 도미넌트(V)는 해결감을 위해 이끈음을 그대로 둬요.'}
        </p>
      )}
      {audio === 'fallback' && <p className="muted small">피아노 샘플을 불러오지 못해 신디사이저 소리로 재생해요 (인터넷 연결 확인).</p>}

      <div className="chord-row">
        {keyed.map((c, i) => {
          const sec = secondaryLabel(c.symbol, key);
          return (
            <button
              key={i}
              className={`chord-chip${i === current ? ' active' : ''}`}
              style={{ flexGrow: c.beats }}
              onClick={() => {
                setSelected(i);
                const vv = voicings[i];
                playNotes([vv.bass, ...vv.rh], 1.6);
              }}
            >
              <span className="chord-name">{prettyChord(c.symbol)}</span>
              <span className="chord-roman">{chordToRoman(c.symbol, key)}</span>
              {sec && <span className="chord-sec">{sec}</span>}
            </button>
          );
        })}
      </div>

      <Piano
        from={36}
        to={84}
        marks={follow.active ? followMarks : marks}
        captions={follow.active ? undefined : captions}
        preferFlats={flats}
        keyName={key}
        onDown={(m) => {
          playNotes([Note.fromMidi(m)], 1.2);
          follow.press(m);
        }}
      />

      <section className="card">
        <div className="card-head">
          <h3>악보</h3>
          <div className="seg">
            <button className={view === 'accomp' ? 'on' : ''} onClick={() => setView('accomp')}>
              반주 악보
            </button>
            <button className={view === 'voicing' ? 'on' : ''} onClick={() => setView('voicing')}>
              코드 보이싱
            </button>
          </div>
        </div>
        <p className="muted small">음표에 마우스를 올리면 계이름(고정도·이동도)과 코드 속 역할이 보여요. 클릭하면 소리가 나요.</p>
        <div className={`follow-bar${follow.active ? ' on' : ''}`}>
          <div className="follow-controls">
            <b>🎹 따라치기</b>
            {follow.active ? (
              <button className="btn small danger-solid" onClick={follow.stop}>
                ■ 그만하기
              </button>
            ) : (
              <button
                className="btn small"
                onClick={() => {
                  if (isPlaying) stopPlayback();
                  follow.start();
                }}
              >
                ▶ 시작
              </button>
            )}
            <div className="seg">
              {(
                [
                  ['rh', '오른손'],
                  ['lh', '왼손'],
                  ['both', '양손'],
                ] as [Hands, string][]
              ).map(([h, label]) => (
                <button key={h} className={hands === h ? 'on' : ''} onClick={() => setHands(h)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="inline-check small">
              <input type="checkbox" checked={octaveFree} onChange={(e) => setOctaveFree(e.target.checked)} /> 옥타브 상관없이
            </label>
            <label className="inline-check small">
              <input type="checkbox" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} /> 건반에 정답 표시
            </label>
            {midiStatus !== 'on' && midiStatus !== 'unsupported' && (
              <button className="btn small ghost" onClick={() => connectMidiHub(true)}>
                MIDI 피아노 연결
              </button>
            )}
          </div>
          {follow.active && (
            <div className="follow-status">
              <span>
                {Math.min(follow.idx + 1, follow.total)} / {follow.total}
              </span>
              <div className="bar follow-progress">
                <div style={{ width: `${(follow.idx / Math.max(1, follow.total)) * 100}%` }} />
              </div>
              <span className={follow.isDue ? 'due-txt' : 'muted'}>{follow.isDue ? '지금! 빨간 음표를 누르세요' : '곧 빨간색으로 바뀌어요…'}</span>
              {follow.lastTiming !== null && <span className="pill">{timingLabel(follow.lastTiming)}</span>}
              <span className="muted small">틀린 음 {follow.errors}</span>
            </div>
          )}
          {!follow.active && follow.result && (
            <div className="follow-status">
              <b>🎉 완주!</b>
              <span>
                {follow.result.steps}번 누르기 · 틀린 음 {follow.result.errors}개 · 평균 박자 오차 {Math.round(follow.result.meanTiming)}ms · {Math.round(follow.result.seconds)}초
              </span>
            </div>
          )}
          {!follow.active && !follow.result && (
            <p className="muted small">
              박자에 맞춰 음표가 빨간색으로 바뀌면 그 음을 정확히 누르세요. 맞게 누를 때까지 기다려줘요. MIDI 피아노가 가장 정확하고, 화면 건반을 눌러도 돼요. 템포는 위 템포 슬라이더를 따라요.
            </p>
          )}
        </div>
        <SheetMusic
          chords={keyed}
          rhythm={view === 'accomp' ? rhythm : getRhythm('whole')}
          keySig={key}
          voicing={voicingMode}
          activeBeat={follow.active && follow.current ? follow.current.t16 / 4 : isPlaying ? playback.beat : undefined}
          follow={follow.active || follow.result ? { cur: follow.current?.t16 ?? null, due: follow.isDue, done: follow.done, hands } : undefined}
          onChordClick={(i) => {
            setSelected(i);
            playNotes([voicings[i].bass, ...voicings[i].rh], 1.6);
          }}
        />
      </section>
      <section className="card rhythm-card">
        <div>
          <h3>리듬 패턴 · {rhythm.name}</h3>
          <p className="muted">{rhythm.description}</p>
          <RhythmGrid rhythm={rhythm} activeBeat={isPlaying ? playback.beat : undefined} />
          <ul className="tips">
            {rhythm.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </section>
      <InversionGuide
        chords={keyed}
        keyName={key}
        mode={voicingMode}
        onModeChange={changeVoicing}
        suggestions={bassSugg}
        applied={slashes}
        onToggleSlash={toggleSlash}
        onSelect={setSelected}
      />
    </div>
  );
}
