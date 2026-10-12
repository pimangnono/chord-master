import { Chord, Key, Note } from 'tonal';
import { playNotes, playSequence } from '../audio/engine';
import { PROGRESSIONS } from '../data/progressions';
import { movableDo } from '../theory/keys';
import { prettyChord, prettyNote, solfege, SOLFEGE_LIST } from '../theory/notes';
import { diatonicChords, parseBars, progressionToChords, romanToChord } from '../theory/roman';
import { voiceChord, voiceProgression } from '../theory/voicing';
import { convertMode } from '../theory/mode';

export interface Question {
  prompt: string;
  sub?: string;
  kind: 'choice' | 'piano' | 'order' | 'play';
  choices?: string[];
  /** choice: the correct label; piano: pitch-class set (0-11); order: chips in order */
  answer: string | number[] | string[];
  play?: () => void;
  replayLabel?: string;
  staffNote?: string;
  pianoMarks?: number[];
  explain: string;
  /** played after answering (e.g. the resolved progression) */
  reveal?: () => void;
  /** order: chips to arrange (answer is the correct order) */
  items?: string[];
  /** how the correct answer is shown in feedback and the 오답 노트 */
  answerText?: string;
  /** play: chords to play on the piano, in order */
  targets?: string[];
  /** play: what each slot shows before it is played ("?", a numeral, the chord to convert) */
  slotLabels?: string[];
}

export interface Stage {
  id: string;
  title: string;
  icon: string;
  goal: string;
  lesson: { title: string; points: string[] };
  make: (rng: Rng) => Question;
  /** progression = the play-on-the-piano chord progression track; theory = basics */
  track?: 'progression' | 'theory';
  /** questions per run (default QUESTIONS_PER_STAGE) */
  count?: number;
}

export type Rng = () => number;

/** Deterministic PRNG (mulberry32) so a question can be regenerated from its seed for review. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const shuffle = <T,>(rng: Rng, arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function choicesWith(rng: Rng, answer: string, pool: string[], n = 4) {
  const others = shuffle(rng, [...new Set(pool)].filter((p) => p !== answer)).slice(0, n - 1);
  return shuffle(rng, [answer, ...others]);
}

const voiced = (symbol: string) => {
  const v = voiceChord(symbol);
  return [v.bass, ...v.rh];
};

const playProgression = (symbols: string[], gap = 1.1) => {
  const vs = voiceProgression(symbols);
  playSequence(
    vs.map((v) => [v.bass, ...v.rh]),
    gap,
    gap * 0.95,
  );
};

const WHITE = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

const INTERVALS: { name: string; semis: number; hint: string }[] = [
  { name: '장2도', semis: 2, hint: '“도–레”, 생일 축하 노래의 “축–하”' },
  { name: '단3도', semis: 3, hint: '“라–도”, 슬픈 느낌의 3도' },
  { name: '장3도', semis: 4, hint: '“도–미”, 밝은 느낌의 3도 (메이저 코드의 3음)' },
  { name: '완전4도', semis: 5, hint: '“솔–도”, 결혼행진곡의 시작' },
  { name: '완전5도', semis: 7, hint: '“도–솔”, 텅 빈 듯 단단한 소리 (파워코드)' },
  { name: '장6도', semis: 9, hint: '“도–라”, 넓고 따뜻한 도약' },
  { name: '옥타브', semis: 12, hint: '같은 이름의 음 — “도–높은 도”' },
];

const CADENCES: { chords: string[]; answer: string; key: string; why: string }[] = [
  { chords: ['ii7', 'V7'], answer: 'Imaj7', key: 'C', why: 'ii–V 다음엔 I로 해결 (ii–V–I)' },
  { chords: ['IV', 'V7'], answer: 'I', key: 'G', why: '도미넌트 V7은 토닉 I로 해결 (정격종지)' },
  { chords: ['iiø7', 'V7'], answer: 'i', key: 'Am', why: '마이너 ii–V 다음엔 단조 토닉 i' },
  { chords: ['IVmaj7', 'V7', 'III7'], answer: 'vi7', key: 'C', why: 'III7 = V7/vi → vi로 해결 (왕도진행 변형)' },
  { chords: ['Imaj7', 'VI7'], answer: 'ii7', key: 'F', why: 'VI7 = V7/ii → ii로 해결' },
  { chords: ['ii7', 'bII7'], answer: 'Imaj7', key: 'C', why: 'bII7은 V7의 트라이톤 대리 → I로 반음 하행' },
  { chords: ['I', 'II7'], answer: 'V7', key: 'D', why: 'II7 = V7/V → V로 해결' },
  { chords: ['i', 'bVII'], answer: 'bVI', key: 'Am', why: '안달루시아 종지: 베이스가 라–솔–파–미로 하행' },
  { chords: ['bVI', 'bVII'], answer: 'I', key: 'C', why: '에픽 종지 bVI–bVII–I (마리오 종지)' },
  { chords: ['I', 'I7'], answer: 'IV', key: 'Bb', why: 'I7 = V7/IV → IV로 해결' },
];

const FAMOUS = ['axis', 'sensitive', 'doowop', 'royal-road', 'epic-minor', 'andalusian', 'mixolydian', 'creep', 'just-two', 'dorian-vamp'];

export const STAGES: Stage[] = [
  {
    id: 'keys',
    title: '건반 위 계이름',
    icon: '🎹',
    goal: '흰 건반의 도레미를 찾아요',
    lesson: {
      title: '건반 지도 읽기',
      points: ['검은 건반 2개 묶음의 바로 왼쪽 흰 건반이 “도(C)”', '도–레–미–파–솔–라–시 = C–D–E–F–G–A–B', '미–파, 시–도 사이에는 검은 건반이 없어요 (반음)'],
    },
    make: (rng) => {
      const letter = pick(rng, WHITE);
      const oct = pick(rng, [3, 4, 5]);
      const midi = Note.midi(letter + oct)!;
      return {
        prompt: '빛나는 건반의 계이름은?',
        kind: 'choice',
        choices: SOLFEGE_LIST,
        answer: solfege(letter),
        pianoMarks: [midi],
        play: () => playNotes([letter + oct], 1),
        explain: `${letter} = ${solfege(letter)}. 검은 건반 묶음을 기준으로 찾으면 빨라요.`,
      };
    },
  },
  {
    id: 'staff',
    title: '오선보 읽기',
    icon: '🎼',
    goal: '높은음자리표의 음을 읽어요',
    lesson: {
      title: '높은음자리표',
      points: ['오선의 아래 첫 줄 = 미(E4), 칸마다 한 음씩 올라가요', '아래 덧줄 하나 = 가온 도(C4)', '줄–칸–줄–칸 순서로: 미 파 솔 라 시 도 레 미 파'],
    },
    make: (rng) => {
      const n = pick(rng, ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5']);
      return {
        prompt: '이 음의 계이름은?',
        kind: 'choice',
        choices: SOLFEGE_LIST,
        answer: solfege(n),
        staffNote: n,
        play: () => playNotes([n], 1),
        explain: `${n} = ${solfege(n)}`,
      };
    },
  },
  {
    id: 'movable',
    title: '이동도법 계이름',
    icon: '🔁',
    goal: '조가 바뀌면 “도”도 따라 움직여요',
    lesson: {
      title: '고정도 vs 이동도',
      points: [
        '고정도: C는 언제나 “도” — 건반의 이름',
        '이동도: 그 조의 으뜸음이 “도” — 음계 안에서의 역할',
        'D장조에서는 레(D)가 “도”, 파♯(F#)은 “미”',
        '단조는 “라”로 시작해요 (A단조: 라–시–도…, D단조: 레가 “라”)',
      ],
    },
    make: (rng) => {
      const key = pick(rng, ['G', 'D', 'F', 'Bb', 'A', 'Eb', 'E']);
      const pc = pick(rng, Key.majorKey(key).scale);
      const n = [pc + 4, pc + 5].find((x) => (Note.midi(x) ?? 0) >= 62 && (Note.midi(x) ?? 99) <= 79) ?? pc + 4;
      const answer = movableDo(n, key);
      return {
        prompt: `${prettyNote(key)}장조에서 이 음의 이동도 계이름은?`,
        sub: `${prettyNote(key)}장조의 으뜸음 ${prettyNote(key)}(${solfege(key)})이 “도”예요`,
        kind: 'choice',
        choices: SOLFEGE_LIST,
        answer,
        staffNote: n,
        play: () => playSequence([[key + 4], [n]], 0.6, 0.8),
        replayLabel: '도 → 이 음 듣기',
        explain: `${prettyNote(n)}: 고정도 “${solfege(n)}”, ${prettyNote(key)}장조 이동도 “${answer}”`,
      };
    },
  },
  {
    id: 'intervals',
    title: '음정 듣기',
    icon: '👂',
    goal: '두 음 사이의 거리를 귀로 구분해요',
    lesson: {
      title: '음정 = 두 음 사이의 거리',
      points: ['반음 2개 = 장2도, 3개 = 단3도, 4개 = 장3도', '반음 5개 = 완전4도, 7개 = 완전5도, 12개 = 옥타브', '좋아하는 노래 첫 두 음으로 외우면 쉬워요'],
    },
    make: (rng) => {
      const iv = pick(rng, INTERVALS);
      const root = pick(rng, ['C4', 'D4', 'E4', 'F4', 'G4']);
      const top = Note.fromMidi(Note.midi(root)! + iv.semis);
      const play = () => playSequence([[root], [top], [root, top]], 0.7, 0.8);
      return {
        prompt: '두 음의 음정은?',
        sub: '먼저 한 음씩, 다음에 동시에 들려줘요',
        kind: 'choice',
        choices: choicesWith(rng, iv.name, INTERVALS.map((i) => i.name)),
        answer: iv.name,
        play,
        replayLabel: '다시 듣기',
        explain: `${iv.name} (반음 ${iv.semis}개): ${iv.hint}`,
      };
    },
  },
  {
    id: 'majmin',
    title: '메이저 vs 마이너',
    icon: '☀️',
    goal: '밝은 코드와 어두운 코드를 구분해요',
    lesson: {
      title: '3음이 분위기를 결정해요',
      points: ['메이저 = 근음 + 장3도 + 완전5도 (도–미–솔): 밝음', '마이너 = 근음 + 단3도 + 완전5도 (도–미♭–솔): 어두움', '두 코드는 3음 하나만 반음 차이!'],
    },
    make: (rng) => {
      const root = pick(rng, ['C', 'D', 'E', 'F', 'G', 'A', 'Bb', 'Eb']);
      const minor = rng() < 0.5;
      const sym = root + (minor ? 'm' : '');
      const ans = minor ? '마이너 (어두움)' : '메이저 (밝음)';
      return {
        prompt: '이 코드는 메이저일까요, 마이너일까요?',
        kind: 'choice',
        choices: ['메이저 (밝음)', '마이너 (어두움)'],
        answer: ans,
        play: () => playNotes(voiced(sym), 1.8),
        replayLabel: '다시 듣기',
        explain: `${prettyChord(sym)} = ${Chord.get(sym).notes.map((n) => solfege(n)).join('–')} (${ans})`,
      };
    },
  },
  {
    id: 'build',
    title: '코드 만들기',
    icon: '🧱',
    goal: '코드 이름을 보고 건반에서 직접 만들어요',
    lesson: {
      title: '코드 = 3도씩 쌓기',
      points: ['메이저: 근음에서 반음 4개 위(3음), 다시 반음 3개 위(5음)', '마이너: 반음 3개 + 반음 4개', '7th 코드: 3화음 위에 7음 추가 (maj7 = 근음 반음 아래, 7 = 온음 아래)'],
    },
    make: (rng) => {
      const sym = pick(rng, ['C', 'F', 'G', 'D', 'A', 'E', 'Am', 'Dm', 'Em', 'Cm', 'Gm', 'Fm', 'Bb', 'Eb', 'Cmaj7', 'Dm7', 'G7', 'Fmaj7', 'Am7', 'Bdim']);
      const c = Chord.get(sym);
      return {
        prompt: `피아노로 ${prettyChord(sym)} 코드를 쳐 보세요`,
        sub: '자리바꿈·옥타브는 자유예요',
        kind: 'play',
        targets: [sym],
        slotLabels: [prettyChord(sym)],
        answer: prettyChord(sym),
        reveal: () => playNotes(voiced(sym), 1.6),
        answerText: `${prettyChord(sym)} = ${c.notes.map((n) => solfege(n)).join('·')}`,
        explain: `${prettyChord(sym)} = ${c.notes.map((n) => `${solfege(n)}(${n})`).join(' + ')}`,
      };
    },
  },
  {
    id: 'diatonic',
    title: '다이아토닉 코드',
    icon: '🪜',
    goal: '조성의 음계 위에 쌓은 7개 코드를 익혀요',
    lesson: {
      title: '장조의 다이아토닉 코드',
      points: ['I  ii  iii  IV  V  vi  vii°', '대문자 = 메이저, 소문자 = 마이너, ° = 디미니시', 'C장조: C  Dm  Em  F  G  Am  B°'],
    },
    make: (rng) => {
      const key = pick(rng, ['C', 'G', 'D', 'F', 'Bb', 'A', 'Eb']);
      const list = diatonicChords(key);
      const target = pick(rng, list.slice(0, 7));
      return {
        prompt: `${key}장조의 ${target.numeral} 코드는?`,
        kind: 'choice',
        choices: choicesWith(rng, prettyChord(target.symbol), list.slice(0, 7).map((d) => prettyChord(d.symbol))),
        answer: prettyChord(target.symbol),
        reveal: () => playNotes(voiced(target.symbol), 1.4),
        explain: `${key}장조: ${list
          .slice(0, 7)
          .map((d) => `${d.numeral}=${prettyChord(d.symbol)}`)
          .join(', ')}`,
      };
    },
  },
  {
    id: 'sevenths',
    title: '7th 코드 귀로 듣기',
    icon: '🎷',
    goal: '재즈의 네 가지 7th 코드를 구분해요',
    lesson: {
      title: '네 가지 7th 코드의 색깔',
      points: ['maj7: 몽환적이고 부드러움 (도–미–솔–시)', 'm7: 차분하고 세련됨 (도–미♭–솔–시♭)', '7 (도미넌트): 해결하고 싶은 긴장 (도–미–솔–시♭)', 'm7♭5: 불안하고 어두움 (도–미♭–솔♭–시♭)'],
    },
    make: (rng) => {
      const types = [
        ['maj7', 'maj7 (메이저 세븐)'],
        ['m7', 'm7 (마이너 세븐)'],
        ['7', '7 (도미넌트 세븐)'],
        ['m7b5', 'm7♭5 (하프 디미니시)'],
      ];
      const [suf, label] = pick(rng, types);
      const root = pick(rng, ['C', 'D', 'F', 'G', 'A', 'Bb']);
      const sym = root + suf;
      return {
        prompt: '이 7th 코드의 종류는?',
        kind: 'choice',
        choices: types.map((t) => t[1]),
        answer: label,
        play: () => playNotes(voiced(sym), 2),
        replayLabel: '다시 듣기',
        explain: `${prettyChord(sym)} = ${Chord.get(sym).notes.map((n) => solfege(n)).join('–')}`,
      };
    },
  },
  {
    id: 'roman',
    title: '로마숫자 분석',
    icon: '🏛️',
    goal: '코드 이름을 도수(로마숫자)로 바꿔요',
    lesson: {
      title: '로마숫자 = 조성 안에서의 위치',
      points: ['로마숫자를 알면 어떤 조로든 바로 옮길 수 있어요', 'C장조 C–G–Am–F = I–V–vi–IV = G장조 G–D–Em–C', 'b는 음계보다 반음 낮은 근음 (bVII = C장조의 B♭)'],
    },
    make: (rng) => {
      const candidates = PROGRESSIONS.filter((p) => parseBars(p.numerals).length === 4);
      const p = pick(rng, candidates);
      const key = pick(rng, p.key.endsWith('m') ? ['Am', 'Em', 'Dm', 'Cm'] : ['C', 'G', 'F', 'D', 'Bb']);
      const chords = progressionToChords(p.numerals, key).map((c) => c.symbol);
      const label = (num: string) => parseBars(num).map((c) => c.symbol).join(' – ');
      const answer = label(p.numerals);
      const pool = candidates.filter((x) => x.key.endsWith('m') === p.key.endsWith('m')).map((x) => label(x.numerals));
      return {
        prompt: chords.map(prettyChord).join(' – '),
        sub: `조성: ${key} — 로마숫자로 분석하면?`,
        kind: 'choice',
        choices: choicesWith(rng, answer, [...new Set(pool)]),
        answer,
        play: () => playProgression(chords, 0.9),
        replayLabel: '진행 듣기',
        explain: `${p.name}: ${p.description}`,
      };
    },
  },
  {
    id: 'ear-prog',
    title: '유명 진행 귀로 맞히기',
    icon: '🏆',
    goal: '히트곡에 숨은 진행을 귀로 알아내요',
    lesson: {
      title: '진행에도 얼굴이 있어요',
      points: ['베이스 라인을 따라가 보세요', '처음 코드가 밝은지(I) 어두운지(vi, i) 먼저 판단', '마지막 코드에서 다시 처음으로 돌아갈 때의 느낌에 집중'],
    },
    make: (rng) => {
      const ps = FAMOUS.map((id) => PROGRESSIONS.find((p) => p.id === id)!).filter(Boolean);
      const p = pick(rng, ps);
      const chords = progressionToChords(p.numerals, p.key).map((c) => c.symbol);
      const groups = voiceProgression(chords).map((v) => [v.bass, ...v.rh]);
      return {
        prompt: '이 진행의 이름은?',
        kind: 'choice',
        choices: choicesWith(rng, p.name, ps.map((x) => x.name)),
        answer: p.name,
        play: () => playSequence(groups, 1.1, 1.05),
        replayLabel: '다시 듣기',
        explain: `${p.numerals} — ${p.description}`,
      };
    },
  },
  {
    id: 'cadence',
    track: 'progression',
    count: 6,
    title: '다음 코드 치기',
    icon: '🔮',
    goal: '진행을 듣고, 이어질 코드를 피아노로 쳐요',
    lesson: {
      title: '해결(Resolution)',
      points: ['V7 → I: 가장 강한 해결 (정격종지)', 'X7 코드는 완전5도 아래로 가고 싶어해요 (부속 도미넌트)', 'bII7 → I: 반음 아래로 미끄러지는 트라이톤 대리', '답은 직접 쳐서 내요 — MIDI 피아노, 마이크, 화면 건반 모두 돼요'],
    },
    make: (rng) => {
      const c = pick(rng, CADENCES);
      const shown = c.chords.map((n) => romanToChord(n, c.key));
      const answer = romanToChord(c.answer, c.key);
      return {
        prompt: `${shown.map(prettyChord).join(' → ')} → ?`,
        sub: `조성: ${c.key} · 이어질 코드를 쳐 보세요`,
        kind: 'play',
        targets: [answer],
        slotLabels: ['?'],
        answer: prettyChord(answer),
        play: () => playProgression(shown),
        replayLabel: '진행 듣기',
        reveal: () => playProgression([...shown, answer]),
        explain: c.why,
      };
    },
  },
  {
    id: 'prog-fill',
    track: 'progression',
    count: 6,
    title: '진행 빈칸 채우기',
    icon: '🧩',
    goal: '유명한 진행의 빠진 코드를 쳐요',
    lesson: {
      title: '진행은 “문장”이에요',
      points: ['진행마다 정해진 흐름이 있어요: 액시스 = I–V–vi–IV', '로마숫자로 외우면 어떤 조에서도 빈칸이 보여요', '모르겠으면 들어보세요 — 빈칸 자리에서 소리가 멈춰요'],
    },
    make: (rng) => {
      const pool = PROGRESSIONS.filter((p) => {
        const n = parseBars(p.numerals).length;
        return n >= 4 && n <= 8 && p.difficulty <= 2;
      });
      const p = pick(rng, pool);
      const key = pick(rng, p.key.endsWith('m') ? ['Am', 'Em', 'Dm', 'Cm', 'Gm'] : ['C', 'G', 'D', 'F', 'Bb', 'A', 'Eb']);
      const chords = progressionToChords(p.numerals, key).map((c) => c.symbol);
      const hole = 1 + Math.floor(rng() * (chords.length - 1));
      return {
        prompt: chords.map((c, i) => (i === hole ? '?' : prettyChord(c))).join(' – '),
        sub: `“${p.name}” · 조성 ${key} · 빈칸의 코드를 쳐 보세요`,
        kind: 'play',
        targets: [chords[hole]],
        slotLabels: ['?'],
        answer: prettyChord(chords[hole]),
        play: () => playProgression(chords.slice(0, hole), 0.9),
        replayLabel: '빈칸 앞까지 듣기',
        reveal: () => playProgression(chords, 0.9),
        explain: `${p.numerals.replace(/\s*\|\s*/g, ' – ')} → ${key}에서 ${chords.map(prettyChord).join(' – ')}`,
      };
    },
  },
  {
    id: 'prog-order',
    track: 'progression',
    count: 5,
    title: '로마숫자 보고 진행 치기',
    icon: '🎼',
    goal: '로마숫자 진행을 주어진 조에서 바로 쳐요',
    lesson: {
      title: '로마숫자 = 조성 안의 자리',
      points: ['I–V–vi–IV를 G장조에서: G D Em C', '대문자 = 장3화음, 소문자 = 단3화음, 7·maj7은 그대로 붙여요', '코드를 하나씩 순서대로 치면 칸이 채워져요'],
    },
    make: (rng) => {
      const pool = PROGRESSIONS.filter((p) => {
        const n = parseBars(p.numerals).length;
        return n === 4 && p.difficulty <= 2;
      });
      const p = pick(rng, pool);
      const key = pick(rng, p.key.endsWith('m') ? ['Am', 'Em', 'Dm'] : ['C', 'G', 'F', 'D']);
      const chords = progressionToChords(p.numerals, key).map((c) => c.symbol);
      return {
        prompt: `“${p.name}”을 ${key}에서 쳐 보세요`,
        sub: p.numerals.replace(/\s*\|\s*/g, ' – '),
        kind: 'play',
        targets: chords,
        slotLabels: parseBars(p.numerals).map((c) => c.symbol),
        answer: chords.map(prettyChord).join(' – '),
        reveal: () => playProgression(chords, 0.9),
        explain: p.description,
      };
    },
  },
  {
    id: 'prog-transpose',
    track: 'progression',
    count: 5,
    title: '진행 조옮김',
    icon: '🚚',
    goal: '같은 진행을 다른 조로 옮겨서 쳐요',
    lesson: {
      title: '조옮김 = 로마숫자는 그대로, 코드 이름만 이동',
      points: ['C장조 I–V–vi–IV = C G Am F', 'G장조로 옮기면 모든 근음이 완전5도 위로: G D Em C', '장·단(메이저/마이너) 성격은 그대로 유지돼요'],
    },
    make: (rng) => {
      const pool = PROGRESSIONS.filter((p) => parseBars(p.numerals).length === 4 && !p.key.endsWith('m') && p.difficulty <= 2);
      const p = pick(rng, pool);
      const keys = ['C', 'G', 'D', 'F', 'Bb', 'A', 'E', 'Eb'];
      const from = pick(rng, keys);
      const to = pick(rng, keys.filter((k) => k !== from));
      const src = progressionToChords(p.numerals, from).map((c) => c.symbol);
      const dst = progressionToChords(p.numerals, to).map((c) => c.symbol);
      return {
        prompt: `${src.map(prettyChord).join(' – ')}  →  ${to}장조로`,
        sub: `${from}장조의 진행을 ${to}장조로 옮겨서 쳐 보세요`,
        kind: 'play',
        targets: dst,
        slotLabels: parseBars(p.numerals).map((c) => c.symbol),
        answer: dst.map(prettyChord).join(' – '),
        play: () => playProgression(src, 0.9),
        replayLabel: '원래 진행 듣기',
        reveal: () => playProgression(dst, 0.9),
        explain: `로마숫자 ${p.numerals.replace(/\s*\|\s*/g, ' – ')}를 ${to}장조에서 읽으면 ${dst.map(prettyChord).join(' – ')}`,
      };
    },
  },
  {
    id: 'prog-mode',
    track: 'progression',
    count: 5,
    title: '장조 ↔ 단조 바꿔 치기',
    icon: '🌗',
    goal: '같은 진행을 어두운 분위기로 바꿔서 쳐요',
    lesson: {
      title: '같은 으뜸음, 다른 분위기',
      points: ['C장조 → C단조: 미·라·시가 반음 내려가요 (미♭·라♭·시♭)', 'C–G–Am–F 는 Cm–G–A♭–Fm 이 돼요', 'V(G)는 해결감을 위해 장3화음 그대로 둬요'],
    },
    make: (rng) => {
      const pool = PROGRESSIONS.filter((p) => parseBars(p.numerals).length === 4 && !p.key.endsWith('m') && p.difficulty === 1);
      const p = pick(rng, pool);
      const key = pick(rng, ['C', 'G', 'D', 'F', 'A']);
      const src = progressionToChords(p.numerals, key);
      const conv = convertMode(src, key);
      const dst = conv.chords.map((c) => c.symbol);
      return {
        prompt: `${src.map((c) => prettyChord(c.symbol)).join(' – ')}  →  ${key}단조로`,
        sub: `${key}장조 “${p.name}”를 같은 으뜸음의 단조로 바꿔서 쳐 보세요`,
        kind: 'play',
        targets: dst,
        slotLabels: src.map((c) => prettyChord(c.symbol)),
        answer: dst.map(prettyChord).join(' – '),
        play: () => playProgression(src.map((c) => c.symbol), 0.9),
        replayLabel: '장조 진행 듣기',
        reveal: () => playProgression(dst, 0.9),
        explain: `${key}단조: 3·6·7음이 반음 내려가 ${dst.map(prettyChord).join(' – ')}. 모든 코드를 마이너로 바꾸는 게 아니에요.`,
      };
    },
  },
  {
    id: 'prog-ear',
    track: 'progression',
    count: 5,
    title: '듣고 따라 치기',
    icon: '🎧',
    goal: '진행을 귀로 듣고 그대로 쳐요',
    lesson: {
      title: '귀로 진행 받아치기',
      points: ['첫 코드는 알려줘요 — 거기서부터 베이스가 어디로 가는지 들어보세요', '밝게 들리면 장3화음(I·IV·V), 어둡게 들리면 단3화음(ii·iii·vi)', '몇 번이든 다시 들어도 돼요'],
    },
    make: (rng) => {
      const ps = FAMOUS.map((id) => PROGRESSIONS.find((p) => p.id === id)!).filter((p) => p && parseBars(p.numerals).length === 4 && p.difficulty <= 2);
      const p = pick(rng, ps);
      const key = p.key.endsWith('m') ? 'Am' : pick(rng, ['C', 'G', 'F']);
      const chords = progressionToChords(p.numerals, key).map((c) => c.symbol);
      return {
        prompt: '들리는 진행을 쳐 보세요',
        sub: `조성 ${key} · 첫 코드는 ${prettyChord(chords[0])}`,
        kind: 'play',
        targets: chords,
        slotLabels: chords.map((c, i) => (i === 0 ? prettyChord(c) : '?')),
        answer: chords.map(prettyChord).join(' – '),
        play: () => playProgression(chords, 1.1),
        replayLabel: '다시 듣기',
        reveal: () => playProgression(chords, 0.9),
        explain: `${p.name}: ${p.numerals.replace(/\s*\|\s*/g, ' – ')}`,
      };
    },
  },
];

export const QUESTIONS_PER_STAGE = 8;
export const HEARTS = 3;

export function starsFor(mistakes: number) {
  return mistakes === 0 ? 3 : mistakes === 1 ? 2 : 1;
}
