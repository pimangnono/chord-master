import { useRef, useState } from 'react';
import { Chord } from 'tonal';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { playNotes } from '../audio/engine';
import { ProgressionStudio } from '../components/ProgressionStudio';
import { RHYTHMS, getRhythm } from '../data/rhythms';
import { intervalBetweenKeys, keyLabel, MAJOR_KEYS, MINOR_KEYS, transposeChord } from '../theory/keys';
import { prettyChord, splitSlash } from '../theory/notes';
import { ChordEvent, chordToRoman, colorChords, diatonicChords } from '../theory/roman';
import { Style, suggestNext } from '../theory/suggest';
import { voiceChord } from '../theory/voicing';
import { SavedProgression, useStore } from '../store';

export function LibraryPage() {
  const { itemId } = useParams();
  if (itemId) return <Builder key={itemId} itemId={itemId} />;
  return <LibraryList />;
}

function LibraryList() {
  const saved = useStore((s) => s.saved);
  const del = useStore((s) => s.deleteProgression);
  const importProgressions = useStore((s) => s.importProgressions);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chord-master-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      const n = importProgressions(Array.isArray(data) ? data : [data]);
      setMsg(`${n}개의 진행을 가져왔어요.`);
    } catch {
      setMsg('파일을 읽을 수 없어요. Chord Master에서 내보낸 JSON 파일인지 확인해 주세요.');
    }
  };

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>내 라이브러리</h1>
          <p className="muted">마음에 드는 진행을 저장하고, 직접 만들고, 파일로 백업할 수 있어요. (이 브라우저에 저장됩니다)</p>
        </div>
        <div className="row gap">
          <Link to="/library/new" className="btn">
            + 새 진행 만들기
          </Link>
          <button className="btn ghost" onClick={exportAll} disabled={!saved.length}>
            내보내기
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            가져오기
          </button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </div>
      </header>
      {msg && <p className="toast inline">{msg}</p>}
      {!saved.length && (
        <div className="card empty">
          <p>아직 저장한 진행이 없어요.</p>
          <p className="muted">장르·시대·노래 페이지에서 “♥ 저장”을 누르거나, 실시간 인식에서 연주 기록을 저장해 보세요.</p>
        </div>
      )}
      <div className="saved-grid">
        {saved.map((p) => (
          <div key={p.id} className="card saved">
            <div className="saved-top">
              <Link to={`/library/${p.id}`}>
                <b>{p.name}</b>
              </Link>
              <span className="muted small">
                {keyLabel(p.key)} · {p.bpm} BPM · {getRhythm(p.rhythm).name}
              </span>
            </div>
            <div className="numerals">
              {p.chords.slice(0, 8).map((c, i) => (
                <span key={i} title={chordToRoman(c.symbol, p.key)}>
                  {prettyChord(c.symbol)}
                </span>
              ))}
              {p.chords.length > 8 && <span>…</span>}
            </div>
            <div className="saved-bottom">
              <span className="muted small">
                {p.source ? `${p.source} · ` : ''}
                {new Date(p.createdAt).toLocaleDateString('ko-KR')}
              </span>
              <div className="row gap">
                <Link to={`/library/${p.id}`} className="btn ghost small">
                  연습·편집
                </Link>
                <button className="btn ghost small danger" onClick={() => confirm(`“${p.name}”을(를) 삭제할까요?`) && del(p.id)}>
                  삭제
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Builder({ itemId }: { itemId: string }) {
  const nav = useNavigate();
  const existing = useStore((s) => s.saved.find((p) => p.id === itemId));
  const save = useStore((s) => s.saveProgression);
  const update = useStore((s) => s.updateProgression);
  const [name, setName] = useState(existing?.name ?? '나의 코드 진행');
  const [key, setKey] = useState(existing?.key ?? 'C');
  const [bpm, setBpm] = useState(existing?.bpm ?? 90);
  const [rhythm, setRhythm] = useState(existing?.rhythm ?? 'pop8');
  const [note, setNote] = useState(existing?.note ?? '');
  const [chords, setChords] = useState<ChordEvent[]>(existing?.chords ?? []);
  const [sevenths, setSevenths] = useState(false);
  const [custom, setCustom] = useState('');
  const [style, setStyle] = useState<Style>('pop');
  const [status, setStatus] = useState<string | null>(null);

  if (itemId !== 'new' && !existing) {
    return (
      <div className="page">
        <p>진행을 찾을 수 없어요.</p>
        <Link to="/library">← 라이브러리</Link>
      </div>
    );
  }

  const add = (symbol: string) => {
    setChords((c) => [...c, { symbol, beats: 4 }]);
    const v = voiceChord(symbol);
    playNotes([v.bass, ...v.rh], 1.2);
  };
  const changeKey = (k: string) => {
    const ivl = intervalBetweenKeys(key, k);
    setChords((cs) => cs.map((c) => ({ ...c, symbol: transposeChord(c.symbol, ivl) })));
    setKey(k);
  };
  const move = (i: number, d: number) =>
    setChords((cs) => {
      const j = i + d;
      if (j < 0 || j >= cs.length) return cs;
      const n = [...cs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const last = chords[chords.length - 1]?.symbol;
  const suggestions = last ? suggestNext(last, key, { style, limit: 6 }) : [];
  const customOk = custom.trim() && !Chord.get(splitSlash(custom.trim())[0]).empty;

  const doSave = () => {
    const data: Omit<SavedProgression, 'id' | 'createdAt'> = { name, key, bpm, rhythm, chords, note, source: existing?.source ?? '직접 만들기' };
    if (existing) {
      update(existing.id, data);
      setStatus('저장했어요 ✓');
    } else {
      const item = save(data);
      nav(`/library/${item.id}`, { replace: true });
    }
    setTimeout(() => setStatus(null), 2000);
  };

  return (
    <div className="page">
      <Link to="/library" className="back">
        ← 라이브러리
      </Link>
      <header className="page-head row">
        <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row gap">
          {status && <span className="muted">{status}</span>}
          <button className="btn" onClick={doSave} disabled={!chords.length}>
            ♥ {existing ? '변경 저장' : '라이브러리에 저장'}
          </button>
        </div>
      </header>

      <div className="card">
        <div className="row gap wrap">
          <label className="field">
            <span>조성 (바꾸면 코드가 함께 이동)</span>
            <select value={key} onChange={(e) => changeKey(e.target.value)}>
              {[...MAJOR_KEYS, ...MINOR_KEYS].map((k) => (
                <option key={k} value={k}>
                  {keyLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>템포</span>
            <input type="number" min={40} max={220} value={bpm} onChange={(e) => setBpm(+e.target.value)} />
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
          <label className="field grow">
            <span>메모</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="이 진행이 좋았던 이유, 어디서 들었는지…" />
          </label>
        </div>

        <h3>진행</h3>
        <div className="builder-chords">
          {!chords.length && <span className="muted">아래 팔레트에서 코드를 눌러 추가하세요.</span>}
          {chords.map((c, i) => (
            <div key={i} className="builder-chip">
              <button className="chord-chip small" onClick={() => playNotes([voiceChord(c.symbol).bass, ...voiceChord(c.symbol).rh], 1.2)}>
                <span className="chord-name">{prettyChord(c.symbol)}</span>
                <span className="chord-roman">{chordToRoman(c.symbol, key)}</span>
              </button>
              <div className="builder-tools">
                <button onClick={() => move(i, -1)} title="앞으로">
                  ◀
                </button>
                <button onClick={() => setChords((cs) => cs.map((x, j) => (j === i ? { ...x, beats: x.beats === 4 ? 2 : x.beats === 2 ? 8 : 4 } : x)))} title="길이 바꾸기">
                  {c.beats}박
                </button>
                <button onClick={() => move(i, 1)} title="뒤로">
                  ▶
                </button>
                <button onClick={() => setChords((cs) => cs.filter((_, j) => j !== i))} title="삭제">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="palette">
          <div className="palette-head">
            <b>다이아토닉 코드</b>
            <button className={`chip-toggle${sevenths ? ' on' : ''}`} onClick={() => setSevenths((s) => !s)}>
              7th 코드
            </button>
          </div>
          <div className="palette-row">
            {diatonicChords(key, sevenths).map((d) => (
              <button key={d.numeral} className={`pal fn-${d.fn}`} onClick={() => add(d.symbol)}>
                <b>{prettyChord(d.symbol)}</b>
                <span>{d.numeral}</span>
              </button>
            ))}
          </div>
          <div className="palette-head">
            <b>색채 코드 (빌린 화음 · 부속 도미넌트)</b>
          </div>
          <div className="palette-row">
            {colorChords(key).map((d) => (
              <button key={d.numeral} className="pal fn-B" onClick={() => add(d.symbol)} title={d.label}>
                <b>{prettyChord(d.symbol)}</b>
                <span>{d.numeral}</span>
              </button>
            ))}
          </div>
          <div className="row gap">
            <input className="search" placeholder="직접 입력 (예: Fmaj7, E7b9, G/B)" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && customOk && (add(custom.trim()), setCustom(''))} />
            <button className="btn ghost" disabled={!customOk} onClick={() => (add(custom.trim()), setCustom(''))}>
              추가
            </button>
          </div>
        </div>

        {last && (
          <div className="palette">
            <div className="palette-head">
              <b>
                {prettyChord(last)} 다음에 어울리는 코드
              </b>
              <select value={style} onChange={(e) => setStyle(e.target.value as Style)}>
                <option value="pop">Pop</option>
                <option value="kpop">K-pop</option>
                <option value="jazz">Jazz</option>
                <option value="bossa">Bossa Nova</option>
                <option value="hiphop">Hip-hop</option>
                <option value="rnb">R&amp;B</option>
              </select>
            </div>
            <div className="palette-row">
              {suggestions.map((s) => (
                <button key={s.symbol} className="pal sugg-pal" onClick={() => add(s.symbol)} title={s.reasons.join('\n')}>
                  <b>{prettyChord(s.symbol)}</b>
                  <span>{s.numeral}</span>
                  <small>{s.reasons[0]}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {chords.length > 0 && (
        <ProgressionStudio owner={`lib:${itemId}`} title={name} chords={chords} baseKey={key} bpm={bpm} rhythm={rhythm} source="직접 만들기" onRhythmChange={setRhythm} />
      )}
    </div>
  );
}
