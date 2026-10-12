import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Accidental, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow';
import { Piano } from '../components/Piano';
import { HEARTS, Question, QUESTIONS_PER_STAGE, Stage, STAGES, starsFor } from '../game/stages';
import { vexKey } from '../notation/score';
import { levelFromXp, useStore } from '../store';

export function GamePage() {
  const { stageId } = useParams();
  const stage = STAGES.find((s) => s.id === stageId);
  return stage ? <StagePlay key={stage.id} stage={stage} /> : <StageMap />;
}

function StageMap() {
  const game = useStore((s) => s.game);
  const lv = levelFromXp(game.xp);
  const totalStars = Object.values(game.stars).reduce((a, b) => a + b, 0);
  return (
    <div className="page">
      <header className="page-head">
        <h1>화성학 게임</h1>
        <p className="muted">스테이지를 깨면서 계이름부터 재즈 화성까지! 하트 3개, 문제 {QUESTIONS_PER_STAGE}개.</p>
      </header>
      <div className="game-stats">
        <div className="stat">
          <b>Lv.{lv.level}</b>
          <span>다음 레벨까지 {lv.toNext} XP</span>
        </div>
        <div className="stat">
          <b>{game.xp}</b>
          <span>총 XP</span>
        </div>
        <div className="stat">
          <b>⭐ {totalStars}</b>
          <span>/ {STAGES.length * 3} 별</span>
        </div>
        <div className="stat">
          <b>🔥 {game.streakDays}</b>
          <span>연속 학습일</span>
        </div>
      </div>
      <div className="stage-map">
        {STAGES.map((s, i) => {
          const stars = game.stars[s.id] ?? 0;
          const unlocked = i === 0 || (game.stars[STAGES[i - 1].id] ?? 0) > 0;
          return (
            <div key={s.id} className={`stage-node ${i % 2 ? 'right' : 'left'}`}>
              {unlocked ? (
                <Link to={`/game/${s.id}`} className={`stage-btn${stars ? ' done' : ''}`}>
                  <span className="stage-icon">{s.icon}</span>
                </Link>
              ) : (
                <span className="stage-btn locked">
                  <span className="stage-icon">🔒</span>
                </span>
              )}
              <div className="stage-info">
                <b>
                  {i + 1}. {s.title}
                </b>
                <span className="muted small">{s.goal}</span>
                <span className="stage-stars">
                  {[1, 2, 3].map((n) => (
                    <span key={n} className={n <= stars ? 'on' : ''}>
                      ★
                    </span>
                  ))}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StaffNote({ note }: { note: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    const r = new Renderer(el, Renderer.Backends.SVG);
    r.resize(220, 150);
    const ctx = r.getContext();
    ctx.scale(1.3, 1.3);
    const stave = new Stave(5, 5, 155).addClef('treble');
    stave.setContext(ctx).draw();
    const n = new StaveNote({ keys: [vexKey(note)], duration: 'w' });
    const voice = new Voice({ num_beats: 4, beat_value: 4 }).addTickables([n]);
    Accidental.applyAccidentals([voice], 'C');
    new Formatter().joinVoices([voice]).format([voice], 70);
    voice.draw(ctx, stave);
  }, [note]);
  return <div className="staff-note" ref={ref} />;
}

type Phase = 'lesson' | 'play' | 'result';

function StagePlay({ stage }: { stage: Stage }) {
  const nav = useNavigate();
  const record = useStore((s) => s.recordGame);
  const [phase, setPhase] = useState<Phase>('lesson');
  const [index, setIndex] = useState(0);
  const [hearts, setHearts] = useState(HEARTS);
  const [mistakes, setMistakes] = useState(0);
  const [combo, setCombo] = useState(0);
  const [xp, setXp] = useState(0);
  const [q, setQ] = useState<Question>(() => stage.make());
  const [picked, setPicked] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<'right' | 'wrong' | null>(null);
  const [final, setFinal] = useState<{ stars: number; xp: number; cleared: boolean } | null>(null);
  const stageIdx = STAGES.findIndex((s) => s.id === stage.id);
  const next = STAGES[stageIdx + 1];

  useEffect(() => {
    if (phase === 'play') q.play?.();
  }, [q, phase]);

  const finish = (cleared: boolean, gained: number, miss: number) => {
    const stars = cleared ? starsFor(miss) : 0;
    const bonus = cleared ? stars * 10 : 0;
    record(stage.id, stars, gained + bonus, cleared ? QUESTIONS_PER_STAGE - miss : 0);
    setFinal({ stars, xp: gained + bonus, cleared });
    setPhase('result');
  };

  const answer = (choice: string | null) => {
    if (result) return;
    let ok: boolean;
    if (q.kind === 'piano') {
      const want = new Set(q.answer as number[]);
      const got = new Set([...sel].map((m) => m % 12));
      ok = want.size === got.size && [...want].every((p) => got.has(p));
    } else {
      ok = choice === q.answer;
      setPicked(choice);
    }
    setResult(ok ? 'right' : 'wrong');
    q.reveal?.();
    if (ok) {
      setCombo((c) => c + 1);
      setXp((x) => x + 10 + Math.min(combo, 5) * 2);
    } else {
      setCombo(0);
      setMistakes((m) => m + 1);
      setHearts((h) => h - 1);
    }
  };

  const advance = () => {
    const outOfHearts = hearts <= 0;
    if (outOfHearts) return finish(false, xp, mistakes);
    if (index + 1 >= QUESTIONS_PER_STAGE) return finish(true, xp, mistakes);
    setIndex((i) => i + 1);
    setQ(stage.make());
    setPicked(null);
    setSel(new Set());
    setResult(null);
  };

  const restart = () => {
    setIndex(0);
    setHearts(HEARTS);
    setMistakes(0);
    setCombo(0);
    setXp(0);
    setQ(stage.make());
    setPicked(null);
    setSel(new Set());
    setResult(null);
    setFinal(null);
    setPhase('play');
  };

  if (phase === 'lesson') {
    return (
      <div className="page narrow">
        <Link to="/game" className="back">
          ← 스테이지 맵
        </Link>
        <div className="card lesson">
          <div className="lesson-icon">{stage.icon}</div>
          <h1>{stage.title}</h1>
          <h3>{stage.lesson.title}</h3>
          <ul className="tips big">
            {stage.lesson.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <button className="btn big" onClick={() => setPhase('play')}>
            시작하기 ▶
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'result' && final) {
    return (
      <div className="page narrow">
        <div className="card lesson">
          <div className="lesson-icon">{final.cleared ? '🎉' : '💔'}</div>
          <h1>{final.cleared ? '스테이지 클리어!' : '하트를 모두 잃었어요'}</h1>
          <div className="big-stars">
            {[1, 2, 3].map((n) => (
              <span key={n} className={n <= final.stars ? 'on' : ''}>
                ★
              </span>
            ))}
          </div>
          <p>+{final.xp} XP</p>
          <div className="row gap center">
            <button className="btn ghost" onClick={restart}>
              다시 하기
            </button>
            {final.cleared && next && (
              <button className="btn" onClick={() => nav(`/game/${next.id}`)}>
                다음 스테이지 ▶
              </button>
            )}
            <button className="btn ghost" onClick={() => nav('/game')}>
              맵으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  const marks = new Map<number, 'active' | 'hint' | 'correct' | 'wrong'>();
  q.pianoMarks?.forEach((m) => marks.set(m, 'hint'));
  if (q.kind === 'piano') {
    const want = new Set(q.answer as number[]);
    sel.forEach((m) => marks.set(m, result ? (want.has(m % 12) ? 'correct' : 'wrong') : 'active'));
  }

  return (
    <div className="page narrow">
      <div className="game-top">
        <Link to="/game" className="back">
          ✕
        </Link>
        <div className="progress">
          <div style={{ width: `${((index + (result ? 1 : 0)) / QUESTIONS_PER_STAGE) * 100}%` }} />
        </div>
        <span className="hearts">
          {Array.from({ length: HEARTS }, (_, i) => (
            <span key={i} className={i < hearts ? 'on' : ''}>
              ♥
            </span>
          ))}
        </span>
      </div>
      {combo >= 3 && <div className="combo">🔥 {combo} 콤보!</div>}
      <div className="card question">
        <h2>{q.prompt}</h2>
        {q.sub && <p className="muted">{q.sub}</p>}
        {q.staffNote && <StaffNote note={q.staffNote} />}
        {q.play && (
          <button className="btn ghost" onClick={() => q.play?.()}>
            🔊 {q.replayLabel ?? '소리 듣기'}
          </button>
        )}
        {(q.pianoMarks || q.kind === 'piano') && (
          <Piano
            from={q.kind === 'piano' ? 48 : 48}
            to={q.kind === 'piano' ? 71 : 83}
            height={140}
            marks={marks}
            onDown={(m) => {
              if (q.kind !== 'piano' || result) return;
              setSel((s) => {
                const n = new Set(s);
                if (n.has(m)) n.delete(m);
                else n.add(m);
                return n;
              });
            }}
          />
        )}
        {q.kind === 'choice' && (
          <div className="choices">
            {q.choices!.map((c) => (
              <button
                key={c}
                className={`choice${result && c === q.answer ? ' right' : ''}${result && c === picked && c !== q.answer ? ' wrong' : ''}`}
                onClick={() => answer(c)}
                disabled={!!result}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {q.kind === 'piano' && !result && (
          <button className="btn" disabled={!sel.size} onClick={() => answer(null)}>
            확인
          </button>
        )}
      </div>
      {result && (
        <div className={`feedback ${result}`}>
          <div>
            <b>{result === 'right' ? '정답이에요! 👏' : `아쉬워요! 정답: ${q.kind === 'choice' ? q.answer : ''}`}</b>
            <p>{q.explain}</p>
          </div>
          <button className="btn" onClick={advance} autoFocus>
            {hearts <= 0 ? '결과 보기' : index + 1 >= QUESTIONS_PER_STAGE ? '완료' : '다음 ▶'}
          </button>
        </div>
      )}
    </div>
  );
}
