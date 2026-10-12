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
  const subtype = genre.subtypes?.find((s) => s.id === params.get('s'));
  const list = PROGRESSIONS.filter((p) => p.genres.includes(genre.id) && (!subtype || p.subtype === subtype.id));
  const selected = PROGRESSION_BY_ID[params.get('p') ?? ''] ?? list[0];
  const songs = SONGS.filter((s) => s.genre === genre.id && (!subtype || s.subtype === subtype.id));
  const setSub = (id?: string) => setParams(id ? { s: id } : {});

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
      {genre.subtypes && (
        <>
          <div className="filters">
            <button className={`chip-toggle${!subtype ? ' on' : ''}`} onClick={() => setSub()}>
              전체 타입
            </button>
            {genre.subtypes.map((s) => (
              <button key={s.id} className={`chip-toggle${subtype?.id === s.id ? ' on' : ''}`} onClick={() => setSub(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
          {subtype ? (
            <section className="card subtype">
              <h3>
                {subtype.name} <small className="muted">{subtype.years}</small>
              </h3>
              <p>{subtype.summary}</p>
              <ul className="tips">
                {subtype.traits.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>
          ) : (
            <div className="subtype-grid">
              {genre.subtypes.map((s) => (
                <button key={s.id} className="subtype-card" onClick={() => setSub(s.id)}>
                  <b>{s.name}</b>
                  <span className="muted small">{s.years}</span>
                  <span className="small">{s.summary}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="split">
        <div className="list">
          {list.map((p) => (
            <ProgressionCard key={p.id} p={p} active={p.id === selected?.id} onClick={() => setParams(subtype ? { s: subtype.id, p: p.id } : { p: p.id })} />
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
