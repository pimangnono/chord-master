import { useEffect } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { stopPlayback, useAudioStatus } from './audio/playback';
import { levelFromXp, useStore } from './store';
import { ErasPage } from './pages/Eras';
import { GamePage } from './pages/Game';
import { GenresPage } from './pages/Genres';
import { HomePage } from './pages/Home';
import { LibraryPage } from './pages/Library';
import { ListenPage } from './pages/Listen';
import { SongPage, SongsPage } from './pages/Songs';
import { AboutPage } from './pages/About';

const NAV = [
  { to: '/', label: '홈', icon: '🏠', end: true },
  { to: '/genres', label: '장르별 진행', icon: '🎼' },
  { to: '/eras', label: '시대별 진행', icon: '🕰️' },
  { to: '/songs', label: '노래로 배우기', icon: '🎵' },
  { to: '/listen', label: '실시간 코드 인식', icon: '🎙️' },
  { to: '/game', label: '화성학 게임', icon: '🎮' },
  { to: '/library', label: '내 라이브러리', icon: '♥' },
];

function StopOnNavigate() {
  const loc = useLocation();
  useEffect(() => {
    stopPlayback();
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return null;
}

function Sidebar() {
  const xp = useStore((s) => s.game.xp);
  const saved = useStore((s) => s.saved.length);
  const labels = useStore((s) => s.pianoLabels);
  const setLabels = useStore((s) => s.setPianoLabels);
  const audio = useAudioStatus();
  const lv = levelFromXp(xp);
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand">
        <span className="brand-logo">♫</span>
        <span>
          Chord Master
          <small>코드 진행 학습</small>
        </span>
      </NavLink>
      <nav>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">{n.icon}</span>
            <span className="nav-label">{n.label}</span>
            {n.to === '/library' && saved > 0 && <span className="badge">{saved}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="side-foot">
        <div className="level">
          <div className="level-top">
            <b>Lv.{lv.level}</b>
            <span>{xp} XP</span>
          </div>
          <div className="bar">
            <div style={{ width: `${Math.round(lv.progress * 100)}%` }} />
          </div>
        </div>
        <label className="field small">
          <span>건반 표시</span>
          <select value={labels} onChange={(e) => setLabels(e.target.value as typeof labels)}>
            <option value="solfege">계이름 (도레미)</option>
            <option value="letters">음이름 (CDE)</option>
            <option value="none">표시 안 함</option>
          </select>
        </label>
        <div className={`audio-dot ${audio}`}>
          {audio === 'idle' && '소리: 첫 재생 시 켜짐'}
          {audio === 'loading' && '피아노 샘플 불러오는 중…'}
          {audio === 'ready' && '그랜드 피아노 준비됨'}
          {audio === 'fallback' && '신디사이저 모드'}
        </div>
        <NavLink to="/about" className="nav-item small">
          오픈소스 & 정보
        </NavLink>
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <HashRouter>
      <StopOnNavigate />
      <div className="app">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/genres" element={<GenresPage />} />
            <Route path="/genres/:genreId" element={<GenresPage />} />
            <Route path="/eras" element={<ErasPage />} />
            <Route path="/eras/:eraId" element={<ErasPage />} />
            <Route path="/songs" element={<SongsPage />} />
            <Route path="/songs/:songId" element={<SongPage />} />
            <Route path="/listen" element={<ListenPage />} />
            <Route path="/game" element={<GamePage />} />
            <Route path="/game/:stageId" element={<GamePage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/:itemId" element={<LibraryPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
