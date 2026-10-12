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
import { noteRole, voiceProgression } from '../theory/voicing';
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

export function ProgressionStudio({ owner, title, chords, baseKey, bpm: initialBpm, rhythm: initialRhythm, genre, source, onRhythmChange }: StudioProps) {
  const [key, setKey] = useState(baseKey);
  const [rhythmId, setRhythmId] = useState(initialRhythm);
  const [bpm, setBpm] = useState(initialBpm);
  const [loop, setLoop] = useState(true);
  const [drums, setDrums] = useState(true);
  const [muteLH, setMuteLH] = useState(false);
  const [muteRH, setMuteRH] = useState(false);
  const [view, setView] = useState<'accomp' | 'voicing'>('accomp');
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState(title);
  const [toast, setToast] = useState<string | null>(null);
  const saveProgression = useStore((s) => s.saveProgression);
  const playback = usePlayback();
  const audio = useAudioStatus();
  const isPlaying = playback.owner === owner;

  useEffect(() => setKey(baseKey), [baseKey]);
  useEffect(() => setRhythmId(initialRhythm), [initialRhythm]);
  useEffect(() => setBpm(initialBpm), [initialBpm]);
  useEffect(() => setSaveName(title), [title]);
  useEffect(() => () => {
    if (usePlayback.getState().owner === owner) stopPlayback();
  }, [owner]);

  const rhythm = getRhythm(rhythmId);
  const ivl = intervalBetweenKeys(baseKey, key);
  const keyed = useMemo(() => chords.map((c) => ({ ...c, symbol: transposeChord(c.symbol, ivl) })), [chords, ivl]);
  const voicings = useMemo(() => voiceProgression(keyed.map((c) => c.symbol)), [keyed]);
  const flats = keyUsesFlats(key);
  const current = isPlaying && playback.chord >= 0 ? playback.chord : selected;
  const v = voicings[current];

  const restart = (patch: Partial<{ key: string; rhythm: string; loop: boolean; drums: boolean; muteLH: boolean; muteRH: boolean }>) => {
    if (!isPlaying) return;
    const next = { key, rhythm: rhythmId, loop, drums, muteLH, muteRH, ...patch };
    const iv = intervalBetweenKeys(baseKey, next.key);
    startPlayback(owner, {
      chords: chords.map((c) => ({ ...c, symbol: transposeChord(c.symbol, iv) })),
      rhythm: getRhythm(next.rhythm),
      bpm,
      loop: next.loop,
      drums: next.drums,
      muteLH: next.muteLH,
      muteRH: next.muteRH,
    });
  };

  const toggle = () => {
    if (isPlaying) stopPlayback();
    else startPlayback(owner, { chords: keyed, rhythm, bpm, loop, drums, muteLH, muteRH });
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
              restart({ key: e.target.value });
            }}
          >
            {keyOptionsFor(parseKey(baseKey).minor).map((k) => (
              <option key={k} value={k}>
                {keyLabel(k)}
              </option>
            ))}
          </select>
        </label>
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

      <Piano from={36} to={84} marks={marks} captions={captions} preferFlats={flats} keyName={key} onDown={(m) => playNotes([Note.fromMidi(m)], 1.2)} />

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
        <SheetMusic
          chords={keyed}
          rhythm={view === 'accomp' ? rhythm : getRhythm('whole')}
          keySig={key}
          activeBeat={isPlaying ? playback.beat : undefined}
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
    </div>
  );
}
