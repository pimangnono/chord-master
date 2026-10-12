import type { Progression } from '../data/progressions';
import { GENRE_BY_ID } from '../data/progressions';
import { parseBars } from '../theory/roman';

export function Stars({ n, max = 3 }: { n: number; max?: number }) {
  return (
    <span className="stars" aria-label={`난이도 ${n}`}>
      {'●'.repeat(n)}
      <span className="off">{'●'.repeat(max - n)}</span>
    </span>
  );
}

export function ProgressionCard({ p, active, onClick }: { p: Progression; active?: boolean; onClick: () => void }) {
  const numerals = parseBars(p.numerals).map((c) => c.symbol);
  return (
    <button className={`prog-card${active ? ' active' : ''}`} onClick={onClick}>
      <div className="prog-card-top">
        <b>{p.name}</b>
        <Stars n={p.difficulty} />
      </div>
      <div className="numerals">
        {numerals.slice(0, 8).map((n, i) => (
          <span key={i}>{n}</span>
        ))}
        {numerals.length > 8 && <span>…</span>}
      </div>
      <div className="prog-card-tags">
        {p.genres.map((g) => (
          <span key={g} className="tag" style={{ '--accent': GENRE_BY_ID[g].color } as React.CSSProperties}>
            {GENRE_BY_ID[g].name}
          </span>
        ))}
        {p.subtype && <span className="tag plain">{p.genres.map((g) => GENRE_BY_ID[g].subtypes?.find((s) => s.id === p.subtype)?.name).find(Boolean) ?? p.subtype}</span>}
        {p.era && <span className="tag plain">{p.era}</span>}
      </div>
    </button>
  );
}
