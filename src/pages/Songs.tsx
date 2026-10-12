import { useMemo, useState } from 'react';
import { Chord } from 'tonal';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { playNotes } from '../audio/engine';
import { Stars } from '../components/ProgressionCard';
import { ProgressionStudio } from '../components/ProgressionStudio';
import { GENRE_BY_ID, GENRES, GenreId } from '../data/progressions';
import { getRhythm, RHYTHMS } from '../data/rhythms';
import { Song, SONGS } from '../data/songs';
import { keyLabel, MAJOR_KEYS, MINOR_KEYS } from '../theory/keys';
import { prettyChord, solfege, splitSlash } from '../theory/notes';
import { chordToRoman, harmonicFunction, parseBars, secondaryLabel } from '../theory/roman';
import { voiceChord } from '../theory/voicing';
import { useStore } from '../store';

function useAllSongs() {
  const custom = useStore((s) => s.customSongs);
  return useMemo(() => [...custom, ...SONGS], [custom]);
}

export function SongsPage() {
  const songs = useAllSongs();
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState<GenreId | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const filtered = songs.filter(
    (s) => (genre === 'all' || s.genre === genre) && (s.title + s.artist).toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>노래로 배우기</h1>
          <p className="muted">배우고 싶은 노래를 고르면 코드 진행 분석과 단계별 반주법을 알려드려요.</p>
        </div>
        <button className="btn" onClick={() => setAdding(true)}>
          + 내 노래 추가
        </button>
      </header>
      {adding && <SongForm onClose={() => setAdding(false)} />}
      <div className="filters">
        <input className="search" placeholder="제목·아티스트 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`chip-toggle${genre === 'all' ? ' on' : ''}`} onClick={() => setGenre('all')}>
          전체
        </button>
        {GENRES.map((g) => (
          <button key={g.id} className={`chip-toggle${genre === g.id ? ' on' : ''}`} onClick={() => setGenre(g.id)}>
            {g.emoji} {g.name}
          </button>
        ))}
      </div>
      <div className="song-grid">
        {filtered.map((s) => (
          <Link key={s.id} to={`/songs/${s.id}`} className="song-card" style={{ '--accent': GENRE_BY_ID[s.genre].color } as React.CSSProperties}>
            <div className="song-card-top">
              <span className="tag" style={{ '--accent': GENRE_BY_ID[s.genre].color } as React.CSSProperties}>
                {GENRE_BY_ID[s.genre].name}
              </span>
              {s.original && <span className="tag plain">오리지널 연습곡</span>}
              {s.custom && <span className="tag plain">내가 추가</span>}
            </div>
            <h3>{s.title}</h3>
            <p className="muted">
              {s.artist}
              {s.year ? ` · ${s.year}` : ''}
            </p>
            <div className="song-card-bottom">
              <span>{keyLabel(s.key)}</span>
              <Stars n={s.difficulty} />
            </div>
            <div className="numerals small">
              {parseBars(s.sections[0].chords)
                .slice(0, 6)
                .map((c, i) => (
                  <span key={i}>{prettyChord(c.symbol)}</span>
                ))}
            </div>
          </Link>
        ))}
        {!filtered.length && <p className="muted">검색 결과가 없어요. 직접 노래를 추가해 보세요!</p>}
      </div>
      <p className="muted small">
        수록곡의 코드는 학습용으로 간략화된 진행이며 가사·멜로디는 포함하지 않아요. 원하는 곡은 “내 노래 추가”로 코드를 직접 입력할 수 있어요.
      </p>
    </div>
  );
}

const STEPS = [
  { id: 1, title: '1단계 · 코드 잡기', rhythm: () => 'whole', desc: '코드가 바뀔 때 한 번만 누르고 길게. 손 모양과 코드 전환에 집중하세요.' },
  { id: 2, title: '2단계 · 기본 리듬', rhythm: () => 'quarter', desc: '4분음표로 박자에 맞춰 코드를 칩니다. 왼손은 근음 → 5음.' },
  { id: 3, title: '3단계 · 원곡 스타일 반주', rhythm: (s: Song) => s.rhythm, desc: '장르에 맞는 리듬 패턴으로 반주를 완성해요.' },
];

export function SongPage() {
  const { songId } = useParams();
  const songs = useAllSongs();
  const nav = useNavigate();
  const deleteSong = useStore((s) => s.deleteSong);
  const song = songs.find((s) => s.id === songId);
  const [section, setSection] = useState(-1);
  const [step, setStep] = useState(3);
  const [rhythmOverride, setRhythmOverride] = useState<string | null>(null);

  const chords = useMemo(() => {
    if (!song) return [];
    const secs = section < 0 ? song.sections : [song.sections[section]];
    return secs.flatMap((s) => parseBars(s.chords));
  }, [song, section]);

  if (!song) {
    return (
      <div className="page">
        <p>노래를 찾을 수 없어요.</p>
        <Link to="/songs">← 목록으로</Link>
      </div>
    );
  }
  const stepDef = STEPS.find((s) => s.id === step)!;
  const rhythmId = rhythmOverride ?? stepDef.rhythm(song);
  const unique = [...new Set(chords.map((c) => c.symbol))];

  return (
    <div className="page">
      <Link to="/songs" className="back">
        ← 노래 목록
      </Link>
      <header className="song-head" style={{ '--accent': GENRE_BY_ID[song.genre].color } as React.CSSProperties}>
        <div>
          <span className="tag" style={{ '--accent': GENRE_BY_ID[song.genre].color } as React.CSSProperties}>
            {GENRE_BY_ID[song.genre].emoji} {GENRE_BY_ID[song.genre].name}
          </span>
          <h1>{song.title}</h1>
          <p className="muted">
            {song.artist}
            {song.year ? ` · ${song.year}` : ''} · {keyLabel(song.key)} · {song.bpm} BPM
          </p>
          <p>{song.about}</p>
        </div>
        {song.custom && (
          <button
            className="btn ghost danger"
            onClick={() => {
              if (confirm('이 노래를 삭제할까요?')) {
                deleteSong(song.id);
                nav('/songs');
              }
            }}
          >
            삭제
          </button>
        )}
      </header>

      <div className="steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            className={`step${s.id === step ? ' active' : ''}`}
            onClick={() => {
              setStep(s.id);
              setRhythmOverride(null);
            }}
          >
            <b>{s.title}</b>
            <span>{getRhythm(s.rhythm(song)).name}</span>
          </button>
        ))}
      </div>
      <p className="muted">{stepDef.desc}</p>

      <div className="tabs small">
        <button className={`tab${section < 0 ? ' active' : ''}`} onClick={() => setSection(-1)}>
          전체
        </button>
        {song.sections.map((s, i) => (
          <button key={i} className={`tab${section === i ? ' active' : ''}`} onClick={() => setSection(i)}>
            {s.name}
          </button>
        ))}
      </div>

      <ProgressionStudio
        owner={`song:${song.id}`}
        title={`${song.title}${section >= 0 ? ` (${song.sections[section].name})` : ''}`}
        chords={chords}
        baseKey={song.key}
        bpm={song.bpm}
        rhythm={rhythmId}
        genre={song.genre}
        source={song.title}
        onRhythmChange={(id) => setRhythmOverride(id)}
      />

      <div className="studio-grid">
        <section className="card">
          <h3>🔍 코드 분석 ({keyLabel(song.key)})</h3>
          <table className="analysis">
            <thead>
              <tr>
                <th>코드</th>
                <th>도수</th>
                <th>기능</th>
                <th>구성음</th>
              </tr>
            </thead>
            <tbody>
              {unique.map((sym) => {
                const fn = harmonicFunction(sym, song.key);
                const sec = secondaryLabel(sym, song.key);
                const v = voiceChord(sym);
                return (
                  <tr key={sym} onClick={() => playNotes([v.bass, ...v.rh], 1.4)}>
                    <td>
                      <b>{prettyChord(sym)}</b>
                    </td>
                    <td>
                      {chordToRoman(sym, song.key)}
                      {sec && <small className="muted"> ({sec})</small>}
                    </td>
                    <td>
                      <span className={`fn fn-${fn.code}`}>{fn.label}</span>
                    </td>
                    <td className="muted">{Chord.get(splitSlash(sym)[0]).notes.map((n) => solfege(n)).join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">행을 클릭하면 코드를 들을 수 있어요. 조성을 바꾸면 위 악보·건반이 함께 바뀝니다.</p>
        </section>
        <section className="card">
          <h3>💡 연습 팁</h3>
          <ul className="tips">
            {song.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function SongForm({ onClose }: { onClose: () => void }) {
  const addSong = useStore((s) => s.addSong);
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [key, setKey] = useState('C');
  const [bpm, setBpm] = useState(90);
  const [genre, setGenre] = useState<GenreId>('pop');
  const [rhythm, setRhythm] = useState('pop8');
  const [text, setText] = useState('벌스: C G | Am F\n후렴: F G | Em Am');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const sections = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l, i) => {
        // "후렴: C G | Am F" — a name needs ": " (chord lengths like "C:3" have no space)
        const m = l.match(/^([^|:]+?):\s+(.+)$/);
        return m ? { name: m[1].trim(), chords: m[2].trim() } : { name: `파트 ${i + 1}`, chords: l };
      });
    if (!title.trim()) return setError('제목을 입력해 주세요.');
    if (!sections.length) return setError('코드를 한 줄 이상 입력해 주세요.');
    const bad = sections.flatMap((s) => parseBars(s.chords).map((c) => c.symbol)).filter((sym) => Chord.get(splitSlash(sym)[0]).empty);
    if (bad.length) return setError(`알 수 없는 코드: ${[...new Set(bad)].join(', ')}`);
    const id = 'custom-' + Date.now().toString(36);
    addSong({ id, title: title.trim(), artist: artist.trim() || '직접 입력', genre, key, bpm, rhythm, difficulty: 1, sections, about: '내가 추가한 노래', tips: [], custom: true });
    onClose();
    nav(`/songs/${id}`);
  };

  return (
    <div className="card form">
      <h3>내 노래 추가</h3>
      <div className="form-grid">
        <label className="field">
          <span>제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>아티스트</span>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
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
          <span>BPM</span>
          <input type="number" min={40} max={220} value={bpm} onChange={(e) => setBpm(+e.target.value)} />
        </label>
        <label className="field">
          <span>장르</span>
          <select value={genre} onChange={(e) => setGenre(e.target.value as GenreId)}>
            {GENRES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>반주 리듬</span>
          <select value={rhythm} onChange={(e) => setRhythm(e.target.value)}>
            {RHYTHMS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>코드 (한 줄에 한 파트 · 마디는 | 로 구분 · 한 마디에 여러 코드는 띄어쓰기)</span>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row gap">
        <button className="btn" onClick={submit}>
          추가하기
        </button>
        <button className="btn ghost" onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  );
}
