import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { playNotes, playSequence, player } from '../audio/engine';
import { startPlayback, stopPlayback, usePlayback } from '../audio/playback';
import { Piano } from '../components/Piano';
import { getRhythm } from '../data/rhythms';
import { IS_ARTIFACT } from '../platform';
import { keyLabel, keyUsesFlats, MAJOR_KEYS, MINOR_KEYS } from '../theory/keys';
import {
  barAt,
  beatsLeftInBar,
  BEATS_PER_BAR,
  chordFn,
  chordPcs,
  decodeSong,
  DEFAULT_SONG,
  encodeSong,
  endingChords,
  FN_LABEL,
  flowNote,
  HIGH,
  LOW,
  MAX_BARS,
  MAX_NOTES,
  MelodyNote,
  moodSong,
  MOODS,
  noteKind,
  noteName,
  noteStarts,
  padVoicing,
  scalePcs,
  Song,
  songToMidi,
  starterChords,
  suggestChords,
  suggestNotes,
  totalBeats,
  transposeSong,
} from '../theory/melody';
import { midiToNote, prettyChord, prettyNote, solfege } from '../theory/notes';
import { colorChords, diatonicChords } from '../theory/roman';

const STORE_KEY = 'chord-master-melody-v1';

const DURATIONS = [
  { beats: 0.5, label: '♪ 반 박 (8분음표)' },
  { beats: 1, label: '♩ 1박 (4분음표)' },
  { beats: 1.5, label: '♩. 1박 반 (점4분음표)' },
  { beats: 2, label: '𝅗𝅥 2박 (2분음표)' },
  { beats: 3, label: '𝅗𝅥. 3박 (점2분음표)' },
  { beats: 4, label: '𝅝 4박 (온음표)' },
];

const BACKINGS = [
  { id: 'whole', label: '길게 누르기' },
  { id: 'ballad-arp', label: '발라드 아르페지오' },
  { id: 'quarter', label: '한 박씩 + 드럼' },
  { id: 'pop8', label: '8비트 팝 + 드럼' },
];

function loadOwn(): Song {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return decodeSong(raw) ?? DEFAULT_SONG;
  } catch {
    /* storage blocked: start fresh */
  }
  return DEFAULT_SONG;
}

function saveOwn(song: Song) {
  try {
    localStorage.setItem(STORE_KEY, encodeSong(song));
  } catch {
    /* ignore */
  }
}

/** Drop or shorten melody steps that would run past the last bar. */
function fitMelody(melody: MelodyNote[], beats: number): MelodyNote[] {
  const out: MelodyNote[] = [];
  let t = 0;
  for (const n of melody) {
    if (t >= beats - 1e-9) break;
    out.push({ ...n, dur: Math.min(n.dur, beats - t) });
    t += n.dur;
  }
  return out;
}

const names = (midis: number[], key: string) => midis.map((m) => midiToNote(m, keyUsesFlats(key)));
const durLabel = (b: number) => DURATIONS.find((d) => d.beats === b)?.label.split(' ')[0] ?? `${b}박`;

function playOpts(song: Song, rhythm: string, withMelody: boolean) {
  const starts = noteStarts(song.melody);
  return {
    chords: song.chords.map((symbol) => ({ symbol, beats: BEATS_PER_BAR })),
    rhythm: getRhythm(rhythm),
    bpm: song.bpm,
    drums: true,
    melody: withMelody
      ? song.melody.flatMap((n, i) => (n.midi === null ? [] : [{ t: starts[i], d: n.dur, midi: n.midi }]))
      : undefined,
  };
}

/* ───────── piano-roll picture of the melody ───────── */
function MelodyRoll({ song, selected, onSelect, beat }: { song: Song; selected: number | null; onSelect: (i: number) => void; beat: number }) {
  const bars = song.chords.length;
  const W = 100 / (bars * BEATS_PER_BAR);
  const starts = noteStarts(song.melody);
  const pitches = song.melody.flatMap((n) => (n.midi === null ? [] : [n.midi]));
  const lo = Math.min(LOW + 4, ...pitches) - 2;
  const hi = Math.max(LOW + 16, ...pitches) + 2;
  const y = (m: number) => ((hi - m) / (hi - lo)) * 100;
  const h = 100 / (hi - lo);
  return (
    <div className="mel-roll" role="img" aria-label="멜로디의 높이와 길이">
      {song.chords.map((c, i) => (
        <div key={i} className="mel-roll-bar" style={{ left: `${i * BEATS_PER_BAR * W}%`, width: `${BEATS_PER_BAR * W}%` }}>
          <span>{prettyChord(c)}</span>
        </div>
      ))}
      {song.melody.map((n, i) =>
        n.midi === null ? (
          <div key={i} className="mel-roll-rest" style={{ left: `${starts[i] * W}%`, width: `${n.dur * W}%` }} />
        ) : (
          <button
            key={i}
            className={`mel-roll-note ${noteKind(n.midi, song.chords[barAt(starts[i])], song.key)}${selected === i ? ' sel' : ''}`}
            style={{ left: `${starts[i] * W}%`, width: `calc(${n.dur * W}% - 2px)`, top: `${y(n.midi) - h / 2}%`, height: `max(${h}%, 8px)` }}
            onClick={() => onSelect(i)}
            title={`${solfege(noteName(n.midi, song.key))} · ${durLabel(n.dur)}`}
          />
        ),
      )}
      {beat >= 0 && <div className="mel-roll-cursor" style={{ left: `${beat * W}%` }} />}
    </div>
  );
}

export function MelodyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [song, setSongRaw] = useState<Song>(loadOwn);
  const [chordUndo, setChordUndo] = useState<string[][]>([]);
  const [melodyUndo, setMelodyUndo] = useState<MelodyNote[][]>([]);
  const [selBar, setSelBar] = useState(0);
  const [selNote, setSelNote] = useState<number | null>(null);
  const [dur, setDur] = useState(1);
  const [seed, setSeed] = useState(1);
  const [rhythm, setRhythm] = useState('ballad-arp');
  const [writing, setWriting] = useState(() => loadOwn().melody.length > 0);
  const [explore, setExplore] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const pb = usePlayback();
  const helpRef = useRef<HTMLDialogElement>(null);

  const shared = useMemo(() => {
    const s = params.get('s');
    return s ? decodeSong(s) : null;
  }, [params]);

  useEffect(() => saveOwn(song), [song]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const setSong = (s: Song) => {
    if (pb.owner?.startsWith('melody')) stopPlayback();
    setSongRaw(s);
  };
  const setChords = (chords: string[]) => {
    setChordUndo((u) => [...u.slice(-30), song.chords]);
    setSong({ ...song, chords, melody: fitMelody(song.melody, chords.length * BEATS_PER_BAR) });
  };
  const setMelody = (melody: MelodyNote[]) => {
    setMelodyUndo((u) => [...u.slice(-60), song.melody]);
    setSong({ ...song, melody });
  };

  const end = song.chords.length * BEATS_PER_BAR;
  const pos = totalBeats(song.melody);
  const full = pos >= end - 1e-9 || song.melody.length >= MAX_NOTES;
  const curBar = Math.min(barAt(pos), song.chords.length - 1);
  const curChord = song.chords[curBar];
  const room = full ? 0 : beatsLeftInBar(pos);
  const addDur = Math.min(dur, room);
  const ideas = useMemo(() => (full ? [] : suggestNotes(song, { seed })), [song, seed, full]);
  const flats = keyUsesFlats(song.key);
  const ending = endingChords(song.key);
  const last = song.chords[song.chords.length - 1];
  const chordIdeas = useMemo(() => suggestChords(song.chords, selBar, song.key), [song.chords, selBar, song.key]);
  const palette = useMemo(() => {
    const tri = diatonicChords(song.key).map((c) => c.symbol);
    const sev = diatonicChords(song.key, true).map((c) => c.symbol);
    const col = colorChords(song.key).map((c) => c.symbol);
    return [...new Set([...tri, ...sev, ...col])];
  }, [song.key]);

  const voiced = (c: string) => names(padVoicing(c), song.key);
  const hearIdea = (midi: number) => playNotes([...voiced(curChord), midiToNote(midi, flats)], 1.3);
  const hearChordIdea = (c: string) => {
    const seq = [song.chords[selBar - 1], c, song.chords[selBar + 1]].filter(Boolean) as string[];
    playSequence(seq.map(voiced), 0.75, 0.9);
  };

  const addNote = (midi: number | null) => {
    if (full || addDur <= 0) return;
    setMelody([...song.melody, { midi, dur: addDur }]);
    setSelNote(null);
    if (midi !== null) playNotes([midiToNote(midi, flats)], 0.6);
  };

  const editNote = (patch: Partial<MelodyNote>) => {
    if (selNote === null) return;
    const next = song.melody.map((n, i) => (i === selNote ? { ...n, ...patch } : n));
    if (totalBeats(next) > end + 1e-9) {
      setToast('마지막 마디를 넘어가요. 마디를 늘리거나 뒤의 음을 지워 주세요.');
      return;
    }
    setMelody(next);
    const m = next[selNote].midi;
    if (patch.midi !== undefined && m !== null) playNotes([midiToNote(m, flats)], 0.5);
  };

  const togglePlay = (owner: string, s: Song, withMelody: boolean) => {
    if (pb.owner === owner) return stopPlayback();
    startPlayback(owner, playOpts(s, rhythm, withMelody));
  };

  const downloadMidi = () => {
    const blob = new Blob([songToMidi(song) as BlobPart], { type: 'audio/midi' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `my-melody-${song.key}.mid`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const shareUrl = song.melody.length ? `${location.origin}${location.pathname}#/melody?s=${encodeURIComponent(encodeSong(song))}` : '';
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast('링크를 복사했어요. 친구에게 보내 보세요!');
    } catch {
      setToast('복사가 막혀 있어요. 아래 칸의 링크를 직접 복사해 주세요.');
    }
  };

  const marks = useMemo(() => {
    const map = new Map<number, 'active' | 'root' | 'hint'>();
    const tones = chordPcs(curChord);
    const scale = scalePcs(song.key);
    for (let m = LOW; m <= HIGH; m++) {
      if (tones.includes(m % 12)) map.set(m, 'root');
      else if (scale.includes(m % 12)) map.set(m, 'hint');
    }
    const sel = selNote !== null ? song.melody[selNote]?.midi : explore;
    if (sel != null) map.set(sel, 'active');
    return map;
  }, [curChord, song.key, selNote, song.melody, explore]);

  const beatCursor = pb.owner === 'melody-all' ? pb.beat : -1;
  const sel = selNote !== null ? song.melody[selNote] : null;

  return (
    <div className="mel-theme">
    <div className="page mel-page">
      <div className="mel-topbar">
        <span className="mel-logo">
          <i>♬</i> 멜로디 만들기 <small>v1</small>
        </span>
        <span className="mel-top-note">● 무료 · 로그인 없이 바로</span>
        <button className="btn small ghost" onClick={() => helpRef.current?.showModal()}>
          ? 처음이라면
        </button>
      </div>

      <section className="mel-hero">
        <div>
          <p className="mel-eyebrow">CHORDS FIRST, THEN A TUNE.</p>
          <h1>
            코드 위에 한 음씩,
            <br />
            나만의 멜로디<span className="mel-accent">.</span>
          </h1>
          <p className="muted">반주를 먼저 정해 두면 어떤 음이 어울릴지 귀로 들려요. 마음에 드는 음만 골라 쌓으면 한 곡이 됩니다.</p>
        </div>
        <div className="mel-hero-art" aria-hidden="true">
          {[3, 6, 4, 8, 5, 7, 2].map((h, i) => (
            <span key={i} style={{ height: `${h * 11}%`, animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </section>

      {shared && (
        <section className="card mel-shared" aria-label="공유받은 곡">
          <div>
            <b>🎁 누군가 만든 멜로디가 도착했어요</b>
            <p className="muted">
              {keyLabel(shared.key)} · {shared.chords.length}마디 · {shared.melody.filter((n) => n.midi !== null).length}음 · {shared.bpm} BPM
            </p>
          </div>
          <div className="row gap">
            <button className={`btn play${pb.owner === 'melody-shared' ? ' on' : ''}`} onClick={() => togglePlay('melody-shared', shared, true)}>
              {pb.owner === 'melody-shared' ? '■ 멈춤' : '▶ 들어 보기'}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setSong(shared);
                setChordUndo([]);
                setMelodyUndo([]);
                setWriting(true);
                navigate('/melody', { replace: true });
                setToast('이 곡을 내 작업으로 가져왔어요. 이어서 만들어 보세요.');
              }}
            >
              이 곡 이어서 만들기
            </button>
            <button className="btn ghost" onClick={() => navigate('/melody', { replace: true })}>
              닫기
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h3>오늘은 어떤 기분의 곡을 써 볼까요?</h3>
          <span className="muted small">고르면 조성·코드·빠르기가 한 번에 정해져요</span>
        </div>
        <div className="mel-moods">
          {MOODS.map((m) => (
            <button
              key={m.id}
              className="mel-mood"
              onClick={() => {
                if (song.melody.length && !confirm('지금 만든 멜로디가 지워져요. 새로 시작할까요?')) return;
                const s = moodSong(m);
                setChordUndo((u) => [...u, song.chords]);
                setMelodyUndo([]);
                setSong(s);
                setSelBar(0);
                setSelNote(null);
                playSequence(s.chords.map((c) => names(padVoicing(c), s.key)), 60 / s.bpm * 2, 1.1);
              }}
            >
              <span className="mel-mood-emoji">{m.emoji}</span>
              <b>{m.name}</b>
              <small>{m.blurb}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>
            <span className="mel-step">01</span> 먼저 코드를 깔아요
          </h3>
          <span className="muted small">
            {keyLabel(song.key)} · {song.chords.length}마디 · 한 마디에 코드 하나(4박)
          </span>
        </div>

        <div className="mel-bars">
          {song.chords.map((c, i) => (
            <button
              key={i}
              className={`mel-bar fn-${chordFn(c, song.key)}${selBar === i ? ' sel' : ''}${pb.owner?.startsWith('melody') && pb.chord === i ? ' now' : ''}`}
              onClick={() => {
                setSelBar(i);
                playNotes(voiced(c), 1.2);
              }}
            >
              <small>{i + 1}마디</small>
              <b>{prettyChord(c)}</b>
              <em>{FN_LABEL[chordFn(c, song.key)]}</em>
            </button>
          ))}
        </div>

        <div className="mel-flow" aria-label="코드의 역할과 흐름">
          {song.chords.map((c, i) => {
            const nxt = song.chords[i + 1];
            const f = nxt ? flowNote(c, nxt, song.key) : null;
            return (
              <span key={i} className="mel-flow-item">
                <b className={`fn-${chordFn(c, song.key)}`}>{FN_LABEL[chordFn(c, song.key)]}</b>
                {f && <em className={f.smooth ? '' : 'rough'}>→ {f.label}</em>}
              </span>
            );
          })}
        </div>
        {song.chords.some((c, i) => i < song.chords.length - 1 && !flowNote(c, song.chords[i + 1], song.key).smooth) && (
          <p className="muted small">💡 ‘거꾸로’는 긴장 다음에 펼침이 오는 곳이에요. 틀린 건 아니지만, 긴장 뒤엔 안정이 오면 더 개운하게 들려요.</p>
        )}

        <div className="mel-chord-help">
          <div>
            <h4>{selBar + 1}마디에 어울리는 코드</h4>
            <p className="muted small">앞뒤 코드와 자연스럽게 이어지는 후보예요. 기본 흐름은 안정 → 펼침 → 긴장 → 다시 안정. ▶는 앞·뒤 코드와 함께 들려줘요.</p>
            <div className="mel-chord-ideas">
              {chordIdeas.map((ci) => (
                <div key={ci.symbol} className={`mel-chord-idea fn-${ci.fn}`}>
                  <button className="btn small ghost" onClick={() => hearChordIdea(ci.symbol)} aria-label={`${ci.symbol} 이어서 듣기`}>
                    ▶
                  </button>
                  <div>
                    <b>{prettyChord(ci.symbol)}</b>
                    <small>{ci.why}</small>
                  </div>
                  <button className="btn small" onClick={() => setChords(song.chords.map((c, i) => (i === selBar ? ci.symbol : c)))}>
                    바꾸기
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4>직접 고르기</h4>
            <div className="mel-palette">
              {palette.map((c) => (
                <button
                  key={c}
                  className={`chip-toggle${song.chords[selBar] === c ? ' on' : ''}`}
                  onClick={() => {
                    setChords(song.chords.map((x, i) => (i === selBar ? c : x)));
                    playNotes(voiced(c), 1);
                  }}
                >
                  {prettyChord(c)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mel-ending">
          <span>마지막 마디는…</span>
          <button className={`btn small ghost${last === ending.loop ? ' on' : ''}`} onClick={() => setChords([...song.chords.slice(0, -1), ending.loop])}>
            ↻ {prettyChord(ending.loop)} · 처음으로 다시 이어지게
          </button>
          <button className={`btn small ghost${last === ending.close ? ' on' : ''}`} onClick={() => setChords([...song.chords.slice(0, -1), ending.close])}>
            ● {prettyChord(ending.close)} · 여기서 끝맺기
          </button>
        </div>

        <div className="row gap wrap mel-toolbar">
          <button className={`btn play${pb.owner === 'melody-chords' ? ' on' : ''}`} onClick={() => togglePlay('melody-chords', song, false)}>
            {pb.owner === 'melody-chords' ? '■ 멈춤' : '▶ 반주만 듣기'}
          </button>
          <button className="btn ghost" disabled={song.chords.length >= MAX_BARS} onClick={() => setChords([...song.chords, song.chords[song.chords.length - 1]])}>
            ＋ 마디 추가
          </button>
          <button
            className="btn ghost"
            disabled={song.chords.length <= 1}
            onClick={() => {
              setChords(song.chords.slice(0, -1));
              setSelBar((b) => Math.min(b, song.chords.length - 2));
            }}
          >
            마지막 마디 빼기
          </button>
          <button
            className="btn ghost"
            disabled={!chordUndo.length}
            onClick={() => {
              const prev = chordUndo[chordUndo.length - 1];
              setChordUndo((u) => u.slice(0, -1));
              setSong({ ...song, chords: prev, melody: fitMelody(song.melody, prev.length * BEATS_PER_BAR) });
              setSelBar((b) => Math.min(b, prev.length - 1));
            }}
          >
            ↶ 되돌리기
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              const chords = starterChords(song.key);
              setChords(chords);
              setSelBar(0);
              playSequence(chords.map(voiced), (60 / song.bpm) * 2, 1.1);
            }}
          >
            ✦ 추천 4마디
          </button>
          {!writing && (
            <button className="btn big mel-go" onClick={() => setWriting(true)}>
              이 코드로 멜로디 쓰기 →
            </button>
          )}
        </div>
        {writing && <p className="muted small">멜로디를 쓰는 중에도 코드는 언제든 바꿀 수 있어요.</p>}
      </section>

      {writing && (
        <div className="mel-work">
          <section className="card mel-compose">
            <div className="card-head">
              <h3>
                <span className="mel-step">02</span> 코드 위에 멜로디를 얹어요
              </h3>
              <span className="muted small">
                {song.melody.filter((n) => n.midi !== null).length}음 · {pos}/{end}박
              </span>
            </div>
            <p className="mel-where" aria-live="polite">
              {full
                ? '🎉 마지막 마디까지 다 채웠어요! 들어 보고, 고치고 싶은 음을 눌러 다듬어 보세요.'
                : `지금 ${curBar + 1}마디 (${prettyChord(curChord)}) · 이 마디에 ${room}박 남음`}
            </p>

            <MelodyRoll song={song} selected={selNote} onSelect={(i) => setSelNote(selNote === i ? null : i)} beat={beatCursor} />

            <div className="mel-seq">
              {song.melody.length === 0 && <span className="muted small">아직 음이 없어요. 오른쪽 후보나 건반에서 첫 음을 골라 보세요.</span>}
              {song.melody.map((n, i) => (
                <button key={i} className={`mel-seq-note${selNote === i ? ' sel' : ''}${n.midi === null ? ' rest' : ''}`} onClick={() => setSelNote(selNote === i ? null : i)}>
                  <b>{n.midi === null ? '쉼' : solfege(noteName(n.midi, song.key))}</b>
                  <small>{durLabel(n.dur)}</small>
                </button>
              ))}
            </div>

            {sel && selNote !== null && (
              <div className="mel-edit">
                <b>{selNote + 1}번째 {sel.midi === null ? '쉼표' : `음 · ${prettyNote(noteName(sel.midi, song.key))}`}</b>
                {sel.midi !== null && (
                  <>
                    <button className="btn small ghost" disabled={sel.midi <= LOW} onClick={() => editNote({ midi: sel.midi! - 1 })}>
                      − 반음
                    </button>
                    <button className="btn small ghost" disabled={sel.midi >= HIGH} onClick={() => editNote({ midi: sel.midi! + 1 })}>
                      ＋ 반음
                    </button>
                  </>
                )}
                <select value={sel.dur} onChange={(e) => editNote({ dur: Number(e.target.value) })} aria-label="길이 바꾸기">
                  {DURATIONS.map((d) => (
                    <option key={d.beats} value={d.beats}>
                      {d.label}
                    </option>
                  ))}
                  {!DURATIONS.some((d) => d.beats === sel.dur) && <option value={sel.dur}>{sel.dur}박</option>}
                </select>
                <button
                  className="btn small danger ghost"
                  onClick={() => {
                    setMelody(song.melody.filter((_, i) => i !== selNote));
                    setSelNote(null);
                  }}
                >
                  지우기
                </button>
                <button className="btn small ghost" onClick={() => setSelNote(null)}>
                  선택 해제
                </button>
              </div>
            )}

            <div className="row gap wrap mel-transport">
              <button className={`btn play${pb.owner === 'melody-all' ? ' on' : ''}`} disabled={!song.melody.length} onClick={() => togglePlay('melody-all', song, true)}>
                {pb.owner === 'melody-all' ? '■ 멈춤' : '▶ 반주랑 같이 듣기'}
              </button>
              <label className="field small mel-tempo">
                <span>
                  빠르기 <b>{song.bpm}</b> BPM
                </span>
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={song.bpm}
                  onChange={(e) => {
                    const bpm = Number(e.target.value);
                    setSongRaw({ ...song, bpm });
                    if (pb.owner?.startsWith('melody')) player.setBpm(bpm);
                  }}
                />
              </label>
              <label className="field small">
                <span>반주</span>
                <select value={rhythm} onChange={(e) => setRhythm(e.target.value)}>
                  {BACKINGS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn ghost"
                disabled={!melodyUndo.length}
                onClick={() => {
                  setSong({ ...song, melody: melodyUndo[melodyUndo.length - 1] });
                  setMelodyUndo((u) => u.slice(0, -1));
                  setSelNote(null);
                }}
              >
                ↶ 되돌리기
              </button>
              <button
                className="btn ghost danger"
                disabled={!song.melody.length}
                onClick={() => {
                  if (!confirm('멜로디를 모두 지울까요? (코드는 그대로예요)')) return;
                  setMelody([]);
                  setSelNote(null);
                }}
              >
                전부 지우기
              </button>
              <button className="btn ghost" disabled={!song.melody.length} onClick={downloadMidi}>
                ↓ MIDI 파일 저장
              </button>
            </div>
          </section>

          <aside className="mel-side">
            <section className="card">
              <div className="card-head">
                <h3>{song.melody.length ? '다음 음 후보' : '첫 음 후보'}</h3>
                <button className="btn small ghost" disabled={full} onClick={() => setSeed((s) => s + 1)}>
                  ↻ 다른 후보
                </button>
              </div>
              <label className="field small">
                <span>추가할 음의 길이</span>
                <select value={dur} onChange={(e) => setDur(Number(e.target.value))}>
                  {DURATIONS.map((d) => (
                    <option key={d.beats} value={d.beats} disabled={d.beats > room && !full}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              {addDur < dur && !full && <p className="muted small">이 마디엔 {room}박만 남아서 {room}박으로 넣을게요.</p>}
              <div className="mel-ideas">
                {ideas.map((idea) => (
                  <div key={idea.midi} className={`mel-idea ${noteKind(idea.midi, curChord, song.key)}`}>
                    <button className="btn small ghost" onClick={() => hearIdea(idea.midi)} aria-label="코드와 함께 들어 보기">
                      ▶
                    </button>
                    <div>
                      <b>
                        {solfege(noteName(idea.midi, song.key))} <span className="muted">{prettyNote(noteName(idea.midi, song.key))}</span>
                      </b>
                      <small>{idea.reason}</small>
                    </div>
                    <button className="btn small" onClick={() => addNote(idea.midi)}>
                      ＋ 넣기
                    </button>
                  </div>
                ))}
                {full && <p className="muted small">마디가 다 찼어요. 마디를 추가하면 계속 쓸 수 있어요.</p>}
              </div>
              <button className="btn ghost small" disabled={full} onClick={() => addNote(null)}>
                ＋ 쉼표 넣기 (숨 한 번 쉬기)
              </button>
              <p className="muted small">▶는 지금 코드와 함께 울려요. 귀로 비교해서 마음에 드는 음을 넣어 보세요.</p>
            </section>

            <section className="card">
              <div className="card-head">
                <h3>건반에서 찾기</h3>
                <span className="muted small">누르면 바로 들어가요</span>
              </div>
              <div className="mel-piano">
                <Piano
                  from={LOW}
                  to={HIGH}
                  height={130}
                  marks={marks}
                  preferFlats={flats}
                  keyName={song.key}
                  onDown={(m) => {
                    setExplore(m);
                    if (selNote !== null && sel?.midi !== null) editNote({ midi: m });
                    else addNote(m);
                  }}
                />
              </div>
              <div className="mel-legend">
                <span>
                  <i className="chord" /> 지금 코드({prettyChord(curChord)})의 음
                </span>
                <span>
                  <i className="scale" /> {keyLabel(song.key)} 음계
                </span>
                <span>
                  <i className="sel" /> 선택한 음
                </span>
              </div>
              <p className="muted small">음을 선택한 상태에서 건반을 누르면 그 음이 바뀌어요.</p>
              <details className="mel-tip">
                <summary>💡 멜로디 쓰는 요령</summary>
                <ul className="tips">
                  <li>마디 첫 박엔 코드의 음(분홍)을 두면 안정적으로 들려요.</li>
                  <li>그 사이는 바로 옆 음으로 계단처럼 이으면 노래하기 쉬워요.</li>
                  <li>크게 뛴 다음엔 반대 방향으로 조금 돌아오면 자연스러워요.</li>
                  <li>2~4마디마다 쉼표나 긴 음으로 숨 쉴 자리를 만들어 주세요.</li>
                </ul>
              </details>
              <label className="field small">
                <span>조성 바꾸기 (코드·멜로디 함께 이동)</span>
                <select value={song.key} onChange={(e) => setSong(transposeSong(song, e.target.value))}>
                  <optgroup label="장조">
                    {MAJOR_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {keyLabel(k)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="단조">
                    {MINOR_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {keyLabel(k)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            </section>
          </aside>
        </div>
      )}

      <section className="card mel-share">
        <h3>🔗 다 만들었으면 링크로 들려주기</h3>
        <p className="muted">코드·멜로디·빠르기가 링크 하나에 담겨요. 받은 사람은 열자마자 바로 들을 수 있어요. 작업은 이 브라우저에 자동 저장됩니다.</p>
        {IS_ARTIFACT ? (
          <p className="muted small">claude.ai 안에서는 공유 링크를 쓸 수 없어요. GitHub Pages 사이트에서 열면 사용할 수 있어요. 대신 MIDI 파일로 저장해 보내 주세요.</p>
        ) : (
          <div className="row gap wrap">
            <button className="btn" disabled={!shareUrl} onClick={copyShare}>
              ↗ 공유 링크 복사
            </button>
            <input className="mel-share-url" readOnly value={shareUrl} placeholder="멜로디를 넣으면 여기에 링크가 생겨요" onFocus={(e) => e.target.select()} aria-label="공유 링크" />
          </div>
        )}
      </section>

      <footer className="mel-footer">
        <b>멜로디 만들기</b>
        <span>흥얼거리던 한 소절을 진짜 곡으로.</span>
        <span>◉ 작업은 이 브라우저에 자동 저장</span>
      </footer>

      <dialog ref={helpRef} className="mel-dialog" onClick={(e) => e.target === helpRef.current && helpRef.current?.close()}>
        <button className="mel-dialog-x" onClick={() => helpRef.current?.close()} aria-label="닫기">
          ×
        </button>
        <h2>이렇게 만들어요</h2>
        <ol>
          <li>
            <b>기분 고르기</b> — 분위기 카드를 누르면 조성·코드·빠르기가 정해져요.
          </li>
          <li>
            <b>코드 다듬기</b> — 마디를 누르고 추천 코드나 목록에서 바꿔요. ▶로 앞뒤와 이어 들어 보세요.
          </li>
          <li>
            <b>음 쌓기</b> — 후보의 ▶로 코드와 함께 들어 보고 ‘넣기’. 건반을 눌러도 바로 들어가요.
          </li>
          <li>
            <b>다듬기</b> — 넣은 음을 누르면 반음 올리기·내리기, 길이 바꾸기, 지우기가 돼요.
          </li>
          <li>
            <b>들려주기</b> — 공유 링크를 복사하거나 MIDI 파일로 저장해 작곡 프로그램에서 이어 작업하세요.
          </li>
        </ol>
        <p className="muted small">분홍 = 지금 코드의 음 · 청록 = 음계 음 · 보라 = 선택한 음</p>
        <button className="btn" onClick={() => helpRef.current?.close()}>
          시작하기
        </button>
      </dialog>

      {toast && (
        <div className="mel-toast" role="status">
          {toast}
        </div>
      )}
    </div>
    </div>
  );
}
