import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Accidental, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow';
import { ConfirmButton } from '../components/ConfirmButton';
import { Piano } from '../components/Piano';
import { PlayAnswer } from '../components/PlayAnswer';
import { HEARTS, newSeed, Question, QUESTIONS_PER_STAGE, seededRng, Stage, STAGES, starsFor } from '../game/stages';
import { vexKey } from '../notation/score';
import { dueMistakes, levelFromXp, Mistake, REVIEW_INTERVALS, useStore } from '../store';

const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));

export function GamePage() {
  const { stageId } = useParams();
  const [params] = useSearchParams();
  // a new query string (another review item, "한 번 더") starts a fresh session
  if (stageId === 'review') return <ReviewPage key={params.toString()} />;
  if (stageId === 'mix') return <MixPage key={params.toString()} />;
  if (stageId === 'notes') return <NotesPage />;
  const stage = stageId ? STAGE_BY_ID[stageId] : undefined;
  return stage ? <StagePlay key={stage.id} stage={stage} /> : <StageMap />;
}

function ReviewCard({ track }: { track: Track }) {
  const game = useStore((s) => s.game);
  const due = dueMistakes(game);
  const total = Object.keys(game.mistakes ?? {}).length;
  const cleared = STAGES.filter((s) => (s.track ?? 'theory') === track && (game.stars[s.id] ?? 0) > 0).length;
  return (
    <section className="card review-card">
      <div>
        <h3>📒 복습</h3>
        <p className="muted small">
          틀린 문제는 오답 노트에 모였다가 1일 → 3일 → 7일 → 14일 간격으로 다시 나와요. 연속으로 맞히면 졸업!
        </p>
      </div>
      <div className="review-stats">
        <div>
          <b>{due.length}</b>
          <span>오늘 복습할 문제</span>
        </div>
        <div>
          <b>{total}</b>
          <span>오답 노트</span>
        </div>
      </div>
      <div className="row gap wrap">
        <Link to="/game/review" className={`btn${due.length ? '' : ' ghost'}`}>
          {due.length ? `오늘의 복습 ${due.length}문제 ▶` : '오늘 복습할 문제 없음'}
        </Link>
        <Link to={`/game/mix?track=${track}`} className={`btn ghost${cleared ? '' : ' disabled-link'}`}>
          🎲 깬 스테이지 섞어 풀기
        </Link>
        <Link to="/game/notes" className="btn ghost">
          오답 노트 보기
        </Link>
      </div>
    </section>
  );
}

type Track = 'progression' | 'theory';

function StageMap() {
  const game = useStore((s) => s.game);
  const [params, setParams] = useSearchParams();
  const track: Track = params.get('track') === 'theory' ? 'theory' : 'progression';
  const lv = levelFromXp(game.xp);
  const stages = STAGES.filter((s) => (s.track ?? 'theory') === track);
  const trackStars = stages.reduce((a, s) => a + (game.stars[s.id] ?? 0), 0);
  return (
    <div className="page">
      <header className="page-head">
        <h1>화성학 게임</h1>
        <p className="muted">
          {track === 'progression'
            ? '코드 진행을 듣고, 보고, 직접 피아노로 쳐서 답해요. MIDI 피아노·마이크(어쿠스틱 피아노)·화면 건반 모두 돼요.'
            : '계이름부터 7th 코드까지 기초 화성학. 하트 3개, 문제 8개.'}
        </p>
      </header>
      <div className="tabs">
        <button className={`tab${track === 'progression' ? ' active' : ''}`} onClick={() => setParams({})}>
          🎹 코드 진행 (피아노로 풀기)
        </button>
        <button className={`tab${track === 'theory' ? ' active' : ''}`} onClick={() => setParams({ track: 'theory' })}>
          📚 기초 화성학
        </button>
      </div>
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
          <b>⭐ {trackStars}</b>
          <span>/ {stages.length * 3} 별</span>
        </div>
        <div className="stat">
          <b>🔥 {game.streakDays}</b>
          <span>연속 학습일</span>
        </div>
      </div>
      <ReviewCard track={track} />
      <div className="stage-map">
        {stages.map((s, i) => {
          const stars = game.stars[s.id] ?? 0;
          const unlocked = i === 0 || (game.stars[stages[i - 1].id] ?? 0) > 0 || stars > 0;
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

interface DeckItem {
  stage: Stage;
  seed: number;
  /** set when the item comes from the 오답 노트 */
  mistakeId?: string;
}

interface RunResult {
  correct: number;
  total: number;
  xp: number;
  outOfHearts: boolean;
  mistakes: number;
}

function answerLabel(q: Question) {
  if (q.answerText) return q.answerText;
  if (q.kind === 'order') return (q.answer as string[]).join(' – ');
  return String(q.answer);
}

/** Plays a deck of questions. `hearts` limits wrong answers (stage play); review has no hearts. */
function QuizRunner({ deck, hearts: maxHearts, onFinish, header }: { deck: DeckItem[]; hearts?: number; onFinish: (r: RunResult) => void; header?: React.ReactNode }) {
  const recordMistake = useStore((s) => s.recordMistake);
  const reviewResult = useStore((s) => s.reviewResult);
  const [index, setIndex] = useState(0);
  const [hearts, setHearts] = useState(maxHearts ?? Infinity);
  const [mistakes, setMistakes] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [combo, setCombo] = useState(0);
  const [xp, setXp] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [order, setOrder] = useState<number[]>([]);
  const [result, setResult] = useState<'right' | 'wrong' | null>(null);
  const item = deck[index];
  const q = useMemo(() => item.stage.make(seededRng(item.seed)), [item]);

  useEffect(() => {
    q.play?.();
  }, [q]);

  const answer = (choice: string | null, decided?: boolean) => {
    if (result) return;
    let ok: boolean;
    if (decided !== undefined) {
      ok = decided;
    } else if (q.kind === 'piano') {
      const want = new Set(q.answer as number[]);
      const got = new Set([...sel].map((m) => m % 12));
      ok = want.size === got.size && [...want].every((p) => got.has(p));
    } else if (q.kind === 'order') {
      ok = order.map((i) => q.items![i]).join('|') === (q.answer as string[]).join('|');
    } else {
      ok = choice === q.answer;
      setPicked(choice);
    }
    setResult(ok ? 'right' : 'wrong');
    q.reveal?.();
    if (item.mistakeId) reviewResult(item.mistakeId, ok);
    else if (!ok) recordMistake({ stageId: item.stage.id, seed: item.seed, prompt: q.prompt + (q.sub ? ` (${q.sub})` : ''), answer: answerLabel(q), explain: q.explain });
    if (ok) {
      setCorrect((c) => c + 1);
      setCombo((c) => c + 1);
      setXp((x) => x + 10 + Math.min(combo, 5) * 2);
    } else {
      setCombo(0);
      setMistakes((m) => m + 1);
      setHearts((h) => h - 1);
    }
  };

  const advance = () => {
    if (hearts <= 0) return onFinish({ correct, total: index + 1, xp, outOfHearts: true, mistakes });
    if (index + 1 >= deck.length) return onFinish({ correct, total: deck.length, xp, outOfHearts: false, mistakes });
    setIndex((i) => i + 1);
    setPicked(null);
    setSel(new Set());
    setOrder([]);
    setResult(null);
  };

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
          <div style={{ width: `${((index + (result ? 1 : 0)) / deck.length) * 100}%` }} />
        </div>
        {maxHearts ? (
          <span className="hearts">
            {Array.from({ length: maxHearts }, (_, i) => (
              <span key={i} className={i < hearts ? 'on' : ''}>
                ♥
              </span>
            ))}
          </span>
        ) : (
          <span className="muted small">
            {index + 1} / {deck.length}
          </span>
        )}
      </div>
      {header}
      {item.mistakeId && <div className="pill alt review-tag">📒 복습 · {item.stage.title}</div>}
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
            from={48}
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
        {q.kind === 'order' && (
          <>
            <div className="order-slots">
              {(q.answer as string[]).map((want, i) => {
                const got = order[i] !== undefined ? q.items![order[i]] : null;
                const cls = result && got ? (got === want ? ' right' : ' wrong') : '';
                return (
                  <span key={i} className={`order-slot${got ? ' filled' : ''}${cls}`}>
                    <small>{i + 1}</small>
                    {got ?? ''}
                  </span>
                );
              })}
            </div>
            <div className="choices">
              {q.items!.map((c, i) => (
                <button key={i} className="choice" disabled={!!result || order.includes(i)} onClick={() => setOrder((o) => [...o, i])}>
                  {c}
                </button>
              ))}
            </div>
            {!result && (
              <div className="row gap">
                <button className="btn ghost" disabled={!order.length} onClick={() => setOrder([])}>
                  다시 놓기
                </button>
                <button className="btn" disabled={order.length !== q.items!.length} onClick={() => answer(null)}>
                  확인
                </button>
              </div>
            )}
          </>
        )}
        {q.kind === 'play' && <PlayAnswer q={q} done={!!result} onComplete={(ok) => answer(null, ok)} />}
        {q.kind === 'piano' && !result && (
          <button className="btn" disabled={!sel.size} onClick={() => answer(null)}>
            확인
          </button>
        )}
      </div>
      {result && (
        <div className={`feedback ${result}`}>
          <div>
            <b>{result === 'right' ? '정답이에요! 👏' : `아쉬워요! 정답: ${answerLabel(q)}`}</b>
            <p>{q.explain}</p>
            {result === 'wrong' && !item.mistakeId && <p className="small">📒 오답 노트에 담았어요. 내일 복습에 다시 나와요.</p>}
            {item.mistakeId && <p className="small">{result === 'right' ? '기억 상자가 한 칸 올라갔어요.' : '처음 상자로 돌아가 내일 다시 나와요.'}</p>}
          </div>
          <button className="btn" onClick={advance} autoFocus>
            {hearts <= 0 ? '결과 보기' : index + 1 >= deck.length ? '완료' : '다음 ▶'}
          </button>
        </div>
      )}
    </div>
  );
}

function Result({ icon, title, lines, children }: { icon: string; title: string; lines: string[]; children?: React.ReactNode }) {
  return (
    <div className="page narrow">
      <div className="card lesson">
        <div className="lesson-icon">{icon}</div>
        <h1>{title}</h1>
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        <div className="row gap center wrap">{children}</div>
      </div>
    </div>
  );
}

/** A run of questions without repeats (re-rolls a seed when its question was already drawn). */
function makeDeck(stage: Stage, n = stage.count ?? QUESTIONS_PER_STAGE): DeckItem[] {
  const seen = new Set<string>();
  const deck: DeckItem[] = [];
  for (let i = 0; i < n; i++) {
    let seed = newSeed();
    for (let tries = 0; tries < 20; tries++) {
      const q = stage.make(seededRng(seed));
      const sig = q.prompt + '|' + (q.sub ?? '');
      if (!seen.has(sig)) {
        seen.add(sig);
        break;
      }
      seed = newSeed();
    }
    deck.push({ stage, seed });
  }
  return deck;
}

function StagePlay({ stage }: { stage: Stage }) {
  const nav = useNavigate();
  const record = useStore((s) => s.recordGame);
  const [phase, setPhase] = useState<'lesson' | 'play' | 'result'>('lesson');
  const [run, setRun] = useState(0);
  const deck = useMemo(() => makeDeck(stage), [stage, run]);
  const [final, setFinal] = useState<{ stars: number; xp: number; cleared: boolean } | null>(null);
  const next = STAGES[STAGES.findIndex((s) => s.id === stage.id) + 1];

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
      <Result icon={final.cleared ? '🎉' : '💔'} title={final.cleared ? '스테이지 클리어!' : '하트를 모두 잃었어요'} lines={[`+${final.xp} XP`]}>
        <div className="big-stars" style={{ width: '100%' }}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= final.stars ? 'on' : ''}>
              ★
            </span>
          ))}
        </div>
        <button
          className="btn ghost"
          onClick={() => {
            setRun((r) => r + 1);
            setFinal(null);
            setPhase('play');
          }}
        >
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
      </Result>
    );
  }

  return (
    <QuizRunner
      key={run}
      deck={deck}
      hearts={HEARTS}
      onFinish={(r) => {
        const cleared = !r.outOfHearts;
        const stars = cleared ? starsFor(r.mistakes) : 0;
        const gained = r.xp + (cleared ? stars * 10 : 0);
        record(stage.id, stars, gained, cleared ? r.correct : 0);
        setFinal({ stars, xp: gained, cleared });
        setPhase('result');
      }}
    />
  );
}

/** Due 오답 노트 items (or all of them, or one by ?id=). */
function ReviewPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.recordGame);
  const [done, setDone] = useState<RunResult | null>(null);
  const deck = useMemo(() => {
    const all = Object.values(game.mistakes ?? {});
    const id = params.get('id');
    const list: Mistake[] = id ? all.filter((m) => m.id === id) : params.get('all') ? all.sort((a, b) => a.box - b.box) : dueMistakes(game);
    return list
      .filter((m) => STAGE_BY_ID[m.stageId])
      .slice(0, 15)
      .map((m) => ({ stage: STAGE_BY_ID[m.stageId], seed: m.seed, mistakeId: m.id }));
    // the deck is fixed when the session starts, even as answers move items between boxes
  }, []);

  if (done) {
    return (
      <Result icon="📒" title="복습 끝!" lines={[`${done.total}문제 중 ${done.correct}개 정답 · +${done.xp} XP`, '맞힌 문제는 더 긴 간격으로, 틀린 문제는 내일 다시 나와요.']}>
        <button className="btn" onClick={() => nav('/game/notes')}>
          오답 노트 보기
        </button>
        <button className="btn ghost" onClick={() => nav('/game')}>
          맵으로
        </button>
      </Result>
    );
  }
  if (!deck.length) {
    return (
      <Result icon="✨" title="오늘 복습할 문제가 없어요" lines={['틀린 문제가 생기면 여기에서 간격을 두고 다시 풀어요.']}>
        {Object.keys(game.mistakes ?? {}).length > 0 && (
          <button className="btn" onClick={() => nav('/game/review?all=1')}>
            오답 노트 전체 다시 풀기
          </button>
        )}
        <button className="btn ghost" onClick={() => nav('/game/mix')}>
          🎲 섞어 풀기
        </button>
        <button className="btn ghost" onClick={() => nav('/game')}>
          맵으로
        </button>
      </Result>
    );
  }
  return (
    <QuizRunner
      deck={deck}
      header={<h2 className="runner-title">📒 오늘의 복습</h2>}
      onFinish={(r) => {
        record('review', 0, Math.round(r.xp / 2), r.correct);
        setDone(r);
      }}
    />
  );
}

/** Ten fresh questions drawn from stages already cleared (weighted toward weaker ones). */
function MixPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.recordGame);
  const [done, setDone] = useState<RunResult | null>(null);
  const deck = useMemo(() => {
    const track = params.get('track');
    const cleared = STAGES.filter((s) => (game.stars[s.id] ?? 0) > 0 && (!track || (s.track ?? 'theory') === track));
    const weighted = cleared.flatMap((s) => Array(4 - (game.stars[s.id] ?? 0)).fill(s) as Stage[]);
    return Array.from({ length: weighted.length ? 10 : 0 }, () => ({ stage: weighted[Math.floor(Math.random() * weighted.length)], seed: newSeed() }));
  }, []);

  if (!deck.length) {
    return (
      <Result icon="🔒" title="아직 깬 스테이지가 없어요" lines={['스테이지를 하나 이상 깨면 섞어 풀기로 복습할 수 있어요.']}>
        <button className="btn" onClick={() => nav('/game')}>
          맵으로
        </button>
      </Result>
    );
  }
  if (done) {
    return (
      <Result icon="🎲" title="섞어 풀기 끝!" lines={[`${done.total}문제 중 ${done.correct}개 정답 · +${done.xp} XP`, done.mistakes ? '틀린 문제는 오답 노트에 담았어요.' : '모두 맞혔어요!']}>
        <button className="btn" onClick={() => nav(`/game/mix?track=${params.get('track') ?? ''}&again=${Date.now()}`)}>
          한 번 더
        </button>
        <button className="btn ghost" onClick={() => nav('/game')}>
          맵으로
        </button>
      </Result>
    );
  }
  return (
    <QuizRunner
      deck={deck}
      header={<h2 className="runner-title">🎲 섞어 풀기</h2>}
      onFinish={(r) => {
        record('mix', 0, r.xp, r.correct);
        setDone(r);
      }}
    />
  );
}

function NotesPage() {
  const game = useStore((s) => s.game);
  const remove = useStore((s) => s.removeMistake);
  const list = Object.values(game.mistakes ?? {}).sort((a, b) => a.due.localeCompare(b.due));
  const today = new Date().toISOString().slice(0, 10);
  const byStage = STAGES.map((s) => ({ stage: s, items: list.filter((m) => m.stageId === s.id) })).filter((g) => g.items.length);
  return (
    <div className="page">
      <Link to="/game" className="back">
        ← 스테이지 맵
      </Link>
      <header className="page-head row">
        <div>
          <h1>오답 노트</h1>
          <p className="muted">틀린 문제와 정답, 설명이 모여 있어요. 상자(●)가 4칸이 될 때까지 맞히면 졸업해요.</p>
        </div>
        <Link to="/game/review?all=1" className={`btn${list.length ? '' : ' ghost'}`}>
          전체 다시 풀기
        </Link>
      </header>
      {!list.length && <div className="card empty">아직 틀린 문제가 없어요. 👏</div>}
      {byStage.map(({ stage, items }) => (
        <section key={stage.id} className="card">
          <h3>
            {stage.icon} {stage.title} <span className="muted small">{items.length}문제</span>
          </h3>
          <div className="notes-list">
            {items.map((m) => (
              <div key={m.id} className="note-item">
                <div className="note-main">
                  <b>{m.prompt}</b>
                  <span>
                    정답: <b className="good-txt">{m.answer}</b>
                  </span>
                  <span className="muted small">{m.explain}</span>
                </div>
                <div className="note-side">
                  <span className="boxes" title={`기억 상자 ${m.box}/4`}>
                    {[1, 2, 3, 4].map((n) => (
                      <i key={n} className={n <= m.box ? 'on' : ''} />
                    ))}
                  </span>
                  <span className="muted small">{m.due <= today ? '오늘 복습' : `${m.due.slice(5).replace('-', '/')} 복습`}</span>
                  <span className="muted small">틀린 횟수 {m.wrongCount}</span>
                  <div className="row gap">
                    <Link to={`/game/review?id=${encodeURIComponent(m.id)}`} className="btn small">
                      다시 풀기
                    </Link>
                    <ConfirmButton label="지우기" confirmLabel="지울까요?" onConfirm={() => remove(m.id)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="muted small">복습 간격: {REVIEW_INTERVALS.slice(1).join('일 → ')}일</p>
    </div>
  );
}
