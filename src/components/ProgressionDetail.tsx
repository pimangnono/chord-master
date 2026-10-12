import { useMemo } from 'react';
import type { GenreId, Progression } from '../data/progressions';
import { progressionToChords } from '../theory/roman';
import { ProgressionStudio } from './ProgressionStudio';

export function ProgressionDetail({ p, genre }: { p: Progression; genre?: GenreId }) {
  const chords = useMemo(() => progressionToChords(p.numerals, p.key), [p]);
  return (
    <div className="detail">
      <div className="detail-head">
        <h2>{p.name}</h2>
        <p>{p.description}</p>
      </div>
      <ProgressionStudio owner={`prog:${p.id}`} title={p.name} chords={chords} baseKey={p.key} bpm={p.bpm} rhythm={p.rhythm} genre={genre ?? p.genres[0]} source={p.name} />
      <div className="studio-grid">
        <section className="card">
          <h3>🧠 화성학 포인트</h3>
          <ul className="tips">
            {p.theory.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
        {p.examples && (
          <section className="card">
            <h3>🎧 이 진행이 쓰인 곡</h3>
            <ul className="tips">
              {p.examples.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
