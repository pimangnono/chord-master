import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ProgressionCard } from '../components/ProgressionCard';
import { ProgressionDetail } from '../components/ProgressionDetail';
import { GENRE_BY_ID, GENRES, GenreId, PROGRESSION_BY_ID, PROGRESSIONS } from '../data/progressions';
import { SONGS } from '../data/songs';

export function GenresPage() {
  const { genreId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const genre = GENRE_BY_ID[(genreId as GenreId) ?? 'pop'] ?? GENRES[0];
  const list = PROGRESSIONS.filter((p) => p.genres.includes(genre.id));
  const selected = PROGRESSION_BY_ID[params.get('p') ?? ''] ?? list[0];
  const songs = SONGS.filter((s) => s.genre === genre.id);

  return (
    <div className="page">
      <header className="page-head">
        <h1>장르별 코드 진행</h1>
        <p className="muted">장르마다 자주 쓰는 진행과 반주 리듬이 달라요. 진행을 고르고 재생해 보세요.</p>
      </header>
      <div className="tabs">
        {GENRES.map((g) => (
          <button key={g.id} className={`tab${g.id === genre.id ? ' active' : ''}`} style={{ '--accent': g.color } as React.CSSProperties} onClick={() => nav(`/genres/${g.id}`)}>
            <span>{g.emoji}</span> {g.name}
          </button>
        ))}
      </div>
      <section className="genre-hero" style={{ '--accent': genre.color } as React.CSSProperties}>
        <div>
          <h2>
            {genre.emoji} {genre.name}
          </h2>
          <p>{genre.summary}</p>
        </div>
        <ul>
          {genre.traits.map((t) => (
            <li key={t}>{t}</li>
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
              <h4>이 장르의 노래</h4>
              <ul className="link-list">
                {songs.map((s) => (
                  <li key={s.id}>
                    <Link to={`/songs/${s.id}`}>
                      {s.title} <span className="muted">– {s.artist}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div>{selected && <ProgressionDetail p={selected} genre={genre.id} />}</div>
      </div>
    </div>
  );
}
