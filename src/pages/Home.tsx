import { Link } from 'react-router-dom';
import { GENRES } from '../data/progressions';
import { STAGES } from '../game/stages';
import { levelFromXp, useStore } from '../store';

const FEATURES = [
  { to: '/genres', icon: '🎼', title: '장르별 진행', body: 'Jazz · K-pop · Pop · Bossa Nova · Hip-hop · R&B(6가지 타입)의 대표 진행과 반주 리듬' },
  { to: '/eras', icon: '🕰️', title: '시대별 진행', body: '50년대 두왑부터 2020년대 로파이까지, 시대를 풍미한 진행' },
  { to: '/songs', icon: '🎵', title: '노래로 배우기', body: '곡을 고르면 코드 분석 + 3단계 반주법 + 악보' },
  { to: '/listen', icon: '🎙️', title: '실시간 코드 인식', body: '피아노 소리(마이크/MIDI)를 듣고 지금 코드와 다음 코드 추천' },
  { to: '/game', icon: '🎮', title: '화성학 게임', body: '계이름부터 7th 코드, 종지까지 스테이지 클리어' },
  { to: '/library', icon: '♥', title: '내 라이브러리', body: '마음에 든 진행 저장 · 직접 만들기 · 백업' },
];

export function HomePage() {
  const game = useStore((s) => s.game);
  const saved = useStore((s) => s.saved);
  const lv = levelFromXp(game.xp);
  const nextStage = STAGES.find((s) => !game.stars[s.id]) ?? STAGES[STAGES.length - 1];
  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>
            코드 진행을 <span className="grad">듣고, 보고, 치면서</span> 배워요
          </h1>
          <p>
            장르와 시대별 진행, 노래 반주법, 악보, 실시간 코드 인식, 그리고 게임처럼 쉬운 화성학까지. 크롬 브라우저 하나로 피아노 앞에서 바로 시작하세요.
          </p>
          <div className="row gap">
            <Link to="/listen" className="btn big">
              🎙️ 내 피아노로 코드 인식하기
            </Link>
            <Link to={`/game/${nextStage.id}`} className="btn big ghost">
              🎮 {nextStage.title} 이어하기
            </Link>
          </div>
        </div>
        <div className="hero-card">
          <div className="level-top">
            <b>Lv.{lv.level}</b>
            <span>{game.xp} XP</span>
          </div>
          <div className="bar">
            <div style={{ width: `${Math.round(lv.progress * 100)}%` }} />
          </div>
          <p className="muted small">🔥 연속 {game.streakDays}일 · ♥ 저장한 진행 {saved.length}개</p>
        </div>
      </section>

      <div className="feature-grid">
        {FEATURES.map((f) => (
          <Link key={f.to} to={f.to} className="feature">
            <span className="feature-icon">{f.icon}</span>
            <b>{f.title}</b>
            <span className="muted">{f.body}</span>
          </Link>
        ))}
      </div>

      <h2>장르 바로가기</h2>
      <div className="genre-row">
        {GENRES.map((g) => (
          <Link key={g.id} to={`/genres/${g.id}`} className="genre-pill" style={{ '--accent': g.color } as React.CSSProperties}>
            <span>{g.emoji}</span>
            <b>{g.name}</b>
            <small>{g.traits[0]}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}
