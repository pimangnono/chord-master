import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ProgressionCard } from '../components/ProgressionCard';
import { ProgressionDetail } from '../components/ProgressionDetail';
import { ERAS, PROGRESSION_BY_ID, PROGRESSIONS } from '../data/progressions';
import { SONGS } from '../data/songs';

export function ErasPage() {
  const { eraId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const era = ERAS.find((e) => e.id === eraId) ?? ERAS[0];
  const list = PROGRESSIONS.filter((p) => p.era === era.id);
  const selected = PROGRESSION_BY_ID[params.get('p') ?? ''] ?? list[0];
  const songs = SONGS.filter((s) => s.era === era.id || (s.year && String(s.year).slice(0, 3) === era.id.slice(0, 3)));

  return (
    <div className="page">
      <header className="page-head">
        <h1>시대별 유행 진행</h1>
        <p className="muted">1950년대 로큰롤부터 2020년대 로파이까지 — 시대마다 사랑받은 코드 진행을 들어보세요.</p>
      </header>
      <div className="timeline">
        {ERAS.map((e) => (
          <button key={e.id} className={`era-dot${e.id === era.id ? ' active' : ''}`} onClick={() => nav(`/eras/${e.id}`)}>
            <span className="era-year">{e.id}</span>
          </button>
        ))}
      </div>
      <section className="genre-hero era">
        <div>
          <h2>
            {era.name} <small className="muted">{era.years}</small>
          </h2>
          <p>{era.summary}</p>
        </div>
        <ul>
          {era.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </section>
      <div className="split">
        <div className="list">
          {list.map((p) => (
            <ProgressionCard key={p.id} p={p} active={p.id === selected?.id} onClick={() => setParams({ p: p.id })} />
          ))}
          {songs.length > 0 && (
            <div className="card">
              <h4>이 시대의 노래</h4>
              <ul className="link-list">
                {songs.map((s) => (
                  <li key={s.id}>
                    <Link to={`/songs/${s.id}`}>
                      {s.title} <span className="muted">– {s.artist}{s.year ? ` (${s.year})` : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div>{selected && <ProgressionDetail p={selected} />}</div>
      </div>
    </div>
  );
}
