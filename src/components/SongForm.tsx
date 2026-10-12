import { useMemo, useRef, useState } from 'react';
import { Chord } from 'tonal';
import { useNavigate } from 'react-router-dom';
import { analyzeSamples, ANALYSIS_RATE, decodeAudioFile } from '../audio/songAnalysis';
import { GENRES, GenreId } from '../data/progressions';
import { RHYTHMS } from '../data/rhythms';
import type { Song } from '../data/songs';
import { estimateKeyFromChords } from '../theory/key';
import { keyLabel, MAJOR_KEYS, MINOR_KEYS } from '../theory/keys';
import { prettyChord, splitSlash } from '../theory/notes';
import { parseBars } from '../theory/roman';
import { parseChordSheet, toBarText } from '../theory/sheet';
import { useStore } from '../store';

type Method = 'paste' | 'audio' | 'manual';

function searchLinks(title: string, artist: string) {
  const q = `${title} ${artist}`.trim();
  const enc = encodeURIComponent;
  return [
    { label: 'Ultimate Guitar', href: `https://www.ultimate-guitar.com/search.php?search_type=title&value=${enc(q)}` },
    { label: 'Google (영문 코드)', href: `https://www.google.com/search?q=${enc(`${q} chords`)}` },
    { label: 'Google (한글 코드 악보)', href: `https://www.google.com/search?q=${enc(`${q} 코드 악보`)}` },
    { label: 'Chordify', href: `https://chordify.net/search/${enc(q)}` },
  ];
}

/** Parses "이름: C G | Am F" lines into sections. Chord lengths like "C:3" have no space after the colon. */
function linesToSections(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      const m = l.match(/^([^|:]+?):\s+(.+)$/);
      return m ? { name: m[1].trim(), chords: m[2].trim() } : { name: `파트 ${i + 1}`, chords: l };
    });
}

export function SongForm({ onClose, initial }: { onClose: () => void; initial?: Song }) {
  const addSong = useStore((s) => s.addSong);
  const nav = useNavigate();
  const [method, setMethod] = useState<Method>(initial ? 'manual' : 'paste');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [artist, setArtist] = useState(initial?.artist ?? '');
  const [key, setKey] = useState(initial?.key ?? 'C');
  const [bpm, setBpm] = useState(initial?.bpm ?? 90);
  const [genre, setGenre] = useState<GenreId>(initial?.genre ?? 'pop');
  const [rhythm, setRhythm] = useState(initial?.rhythm ?? 'pop8');
  const [text, setText] = useState(initial ? initial.sections.map((s) => `${s.name}: ${s.chords}`).join('\n') : '');
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<string | null>(null);

  // paste
  const [sheet, setSheet] = useState('');
  const [perBar, setPerBar] = useState(1);
  const [useCapo, setUseCapo] = useState(true);
  const parsed = useMemo(() => (sheet.trim() ? parseChordSheet(sheet, useCapo) : null), [sheet, useCapo]);

  // audio
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [audioNote, setAudioNote] = useState<string | null>(null);

  const fill = (lines: string, detectedKey: string | undefined, how: string) => {
    setText(lines);
    if (detectedKey) setKey(detectedKey);
    setFilled(how);
    setError(null);
  };

  const applySheet = () => {
    if (!parsed || !parsed.sections.length) return;
    fill(parsed.sections.map((s) => `${s.name}: ${toBarText(s.chords, perBar)}`).join('\n'), parsed.key, '붙여넣은 코드 악보');
  };

  const analyzeFile = async (file: File) => {
    setError(null);
    setAudioNote(null);
    setProgress(0);
    try {
      const samples = await decodeAudioFile(file);
      if (samples.length > ANALYSIS_RATE * 60 * 12) throw new Error('12분 이하의 파일을 넣어 주세요.');
      const r = await analyzeSamples(samples, ANALYSIS_RATE, setProgress);
      if (!r.sections.length) throw new Error('코드를 찾지 못했어요. 소리가 들어 있는 음원인지 확인해 주세요.');
      setBpm(Math.min(200, Math.max(50, r.bpm)));
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
      fill(r.sections.map((s) => `${s.name}: ${s.chords}`).join('\n'), r.key, '음원 자동 분석');
      setAudioNote(`템포 약 ${r.bpm} BPM · ${Math.round(r.duration)}초 분석 · 같은 8마디가 반복되는 부분은 한 번만 남겼어요.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이 파일을 읽을 수 없어요. MP3, WAV, M4A 파일을 넣어 주세요.');
    } finally {
      setProgress(null);
    }
  };

  const sections = linesToSections(text);
  const allChords = sections.flatMap((s) => parseBars(s.chords).map((c) => c.symbol));
  const bad = [...new Set(allChords.filter((sym) => Chord.get(splitSlash(sym)[0]).empty))];
  const guessKey = allChords.length ? estimateKeyFromChords(allChords, Infinity, 1)[0]?.key : undefined;

  const submit = () => {
    if (!title.trim()) return setError('제목을 입력해 주세요.');
    if (!sections.length) return setError('코드를 한 줄 이상 넣어 주세요.');
    if (bad.length) return setError(`알 수 없는 코드: ${bad.join(', ')} — 아래 칸에서 고쳐 주세요.`);
    const id = initial?.id ?? 'custom-' + Date.now().toString(36);
    addSong({
      id,
      title: title.trim(),
      artist: artist.trim() || '직접 입력',
      genre,
      key,
      bpm,
      rhythm,
      difficulty: 1,
      sections,
      about: initial?.about ?? (filled ? `${filled}로 추가한 노래` : '내가 추가한 노래'),
      tips: initial?.tips ?? [],
      custom: true,
    });
    onClose();
    nav(`/songs/${id}`);
  };

  return (
    <div className="card form">
      <h3>{initial ? '노래 편집' : '내 노래 추가'}</h3>
      <div className="form-grid">
        <label className="field">
          <span>제목</span>
          <input id="song-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 밤편지" />
        </label>
        <label className="field">
          <span>아티스트</span>
          <input id="song-artist" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="예: 아이유" />
        </label>
      </div>

      {!initial && (
        <div className="seg big">
          <button className={method === 'paste' ? 'on' : ''} onClick={() => setMethod('paste')}>
            📋 코드 악보 붙여넣기
          </button>
          <button className={method === 'audio' ? 'on' : ''} onClick={() => setMethod('audio')}>
            🎧 음원 파일로 자동 분석
          </button>
          <button className={method === 'manual' ? 'on' : ''} onClick={() => setMethod('manual')}>
            ✏️ 직접 입력
          </button>
        </div>
      )}

      {method === 'paste' && (
        <div className="import-box">
          <p className="small">
            <b>1.</b> 아래 링크로 노래의 코드 악보를 찾아 페이지 내용을 통째로 복사하세요.
            {!title.trim() && <span className="muted"> (제목을 먼저 입력하면 바로 검색돼요)</span>}
          </p>
          {title.trim() && (
            <div className="row gap wrap">
              {searchLinks(title, artist).map((l) => (
                <a key={l.label} className="btn ghost small" href={l.href} target="_blank" rel="noreferrer">
                  🔎 {l.label}
                </a>
              ))}
            </div>
          )}
          <p className="small">
            <b>2.</b> 여기에 붙여넣으면 가사는 버리고 코드만 뽑아요. 섹션([Verse], [Chorus]…), 반복(x2), 카포도 알아봐요.
          </p>
          <textarea id="song-sheet" rows={7} value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder={'[Verse]\nC        G\n가사 가사 가사\nAm       F\n가사 가사 가사'} />
          {parsed && (
            <div className="parse-preview">
              {parsed.sections.length === 0 ? (
                <p className="error">코드를 찾지 못했어요. 코드 줄(C G Am F 같은 줄)이 들어 있는지 확인해 주세요.</p>
              ) : (
                <>
                  <p className="small">
                    코드 {parsed.chordCount}개 · 섹션 {parsed.sections.length}개 · 추정 조성 <b>{parsed.key ? keyLabel(parsed.key) : '?'}</b>
                    {parsed.capo > 0 && (
                      <label className="inline-check">
                        <input type="checkbox" checked={useCapo} onChange={(e) => setUseCapo(e.target.checked)} /> 카포 {parsed.capo} 반영 (실제 소리 높이로)
                      </label>
                    )}
                  </p>
                  {parsed.sections.map((s) => (
                    <div key={s.name} className="parse-section">
                      <b>{s.name}</b>
                      <div className="numerals small">
                        {s.chords.map((c, i) => (
                          <span key={i}>{prettyChord(c)}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {parsed.unknown.length > 0 && <p className="muted small">무시한 기호: {parsed.unknown.slice(0, 12).join(' ')}</p>}
                  <div className="row gap wrap">
                    <label className="field">
                      <span>한 마디에 코드</span>
                      <select value={perBar} onChange={(e) => setPerBar(+e.target.value)}>
                        <option value={1}>1개 (4박)</option>
                        <option value={2}>2개 (2박씩)</option>
                      </select>
                    </label>
                    <button className="btn" onClick={applySheet}>
                      이 코드로 채우기 ↓
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {method === 'audio' && (
        <div className="import-box">
          <p className="small">
            노래 음원(MP3·WAV·M4A)을 넣으면 브라우저 안에서 박자와 코드를 추정해요. 파일은 어디에도 올라가지 않아요. 드럼·보컬이 많은 곡은 틀릴 수 있으니 결과를 듣고 고쳐 주세요.
          </p>
          <div className="row gap wrap">
            <button className="btn" disabled={progress !== null} onClick={() => fileRef.current?.click()}>
              {progress !== null ? `분석 중… ${Math.round(progress * 100)}%` : '🎧 음원 파일 선택'}
            </button>
            <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && analyzeFile(e.target.files[0])} />
            {progress !== null && (
              <div className="meter wide">
                <div style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
          {audioNote && <p className="muted small">{audioNote}</p>}
        </div>
      )}

      <div className="form-grid">
        <label className="field">
          <span>조성{guessKey && guessKey !== key ? ` (코드로 보면 ${guessKey} 같아요)` : ''}</span>
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
        <span>
          코드 (한 줄에 한 파트 “이름: 코드” · 마디는 | 로 구분 · 한 마디에 여러 코드는 띄어쓰기){filled && <b className="accent"> — {filled} 결과를 채웠어요. 확인하고 고쳐 주세요</b>}
        </span>
        <textarea id="song-chords" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'벌스: C G | Am F\n후렴: F G | Em Am'} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row gap">
        <button className="btn" onClick={submit}>
          {initial ? '저장하기' : '추가하기'}
        </button>
        <button className="btn ghost" onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  );
}
