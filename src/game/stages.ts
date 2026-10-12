import { Chord, Key, Note } from 'tonal';
import { playNotes, playSequence } from '../audio/engine';
import { PROGRESSIONS } from '../data/progressions';
import { movableDo } from '../theory/keys';
import { prettyChord, prettyNote, solfege, SOLFEGE_LIST } from '../theory/notes';
import { diatonicChords, parseBars, progressionToChords, romanToChord } from '../theory/roman';
import { voiceChord, voiceProgression } from '../theory/voicing';

export interface Question {
  prompt: string;
  sub?: string;
  kind: 'choice' | 'piano';
  choices?: string[];
  /** choice: the correct label; piano: pitch-class set (0-11) */
  answer: string | number[];
  play?: () => void;
  replayLabel?: string;
  staffNote?: string;
  pianoMarks?: number[];
  explain: string;
  /** played after answering (e.g. the resolved progression) */
  reveal?: () => void;
}

export interface Stage {
  id: string;
  title: string;
  icon: string;
  goal: string;
  lesson: { title: string; points: string[] };
  make: () => Question;
}

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function choicesWith(answer: string, pool: string[], n = 4) {
  const others = shuffle(pool.filter((p) => p !== answer)).slice(0, n - 1);
  return shuffle([answer, ...others]);
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
    make: () => {
      const letter = pick(WHITE);
      const oct = pick([3, 4, 5]);
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
    make: () => {
      const n = pick(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5']);
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
    make: () => {
      const key = pick(['G', 'D', 'F', 'Bb', 'A', 'Eb', 'E']);
      const pc = pick(Key.majorKey(key).scale);
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
    make: () => {
      const iv = pick(INTERVALS);
      const root = pick(['C4', 'D4', 'E4', 'F4', 'G4']);
      const top = Note.fromMidi(Note.midi(root)! + iv.semis);
      const play = () => playSequence([[root], [top], [root, top]], 0.7, 0.8);
      return {
        prompt: '두 음의 음정은?',
        sub: '먼저 한 음씩, 다음에 동시에 들려줘요',
        kind: 'choice',
        choices: choicesWith(iv.name, INTERVALS.map((i) => i.name)),
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
    make: () => {
      const root = pick(['C', 'D', 'E', 'F', 'G', 'A', 'Bb', 'Eb']);
      const minor = Math.random() < 0.5;
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
    make: () => {
      const sym = pick(['C', 'F', 'G', 'D', 'A', 'E', 'Am', 'Dm', 'Em', 'Cm', 'Gm', 'Fm', 'Bb', 'Eb', 'Cmaj7', 'Dm7', 'G7', 'Fmaj7', 'Am7', 'Bdim']);
      const c = Chord.get(sym);
      return {
        prompt: `건반에서 ${prettyChord(sym)} 코드를 만들어 보세요`,
        sub: '건반을 눌러 음을 선택하고 “확인”을 누르세요 (옥타브는 상관없어요)',
        kind: 'piano',
        answer: c.notes.map((n) => Note.chroma(n)!),
        reveal: () => playNotes(voiced(sym), 1.6),
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
    make: () => {
      const key = pick(['C', 'G', 'D', 'F', 'Bb', 'A', 'Eb']);
      const list = diatonicChords(key);
      const target = pick(list.slice(0, 7));
      return {
        prompt: `${key}장조의 ${target.numeral} 코드는?`,
        kind: 'choice',
        choices: choicesWith(prettyChord(target.symbol), list.slice(0, 7).map((d) => prettyChord(d.symbol))),
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
    make: () => {
      const types = [
        ['maj7', 'maj7 (메이저 세븐)'],
        ['m7', 'm7 (마이너 세븐)'],
        ['7', '7 (도미넌트 세븐)'],
        ['m7b5', 'm7♭5 (하프 디미니시)'],
      ];
      const [suf, label] = pick(types);
      const root = pick(['C', 'D', 'F', 'G', 'A', 'Bb']);
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
    id: 'cadence',
    title: '다음 코드 맞히기',
    icon: '🔮',
    goal: '코드가 가고 싶어하는 방향을 느껴요',
    lesson: {
      title: '해결(Resolution)',
      points: ['V7 → I: 가장 강한 해결 (정격종지)', 'X7 코드는 완전5도 아래로 가고 싶어해요 (부속 도미넌트)', 'bII7 → I: 반음 아래로 미끄러지는 트라이톤 대리'],
    },
    make: () => {
      const c = pick(CADENCES);
      const shown = c.chords.map((n) => romanToChord(n, c.key));
      const answer = romanToChord(c.answer, c.key);
      const pool = [...diatonicChords(c.key, /7|ø/.test(c.answer)).map((d) => d.symbol), answer];
      return {
        prompt: `${shown.map(prettyChord).join(' → ')} → ?`,
        sub: `조성: ${c.key}`,
        kind: 'choice',
        choices: choicesWith(prettyChord(answer), [...new Set(pool.map(prettyChord))]),
        answer: prettyChord(answer),
        play: () => playProgression(shown),
        replayLabel: '진행 듣기',
        reveal: () => playProgression([...shown, answer]),
        explain: c.why,
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
    make: () => {
      const candidates = PROGRESSIONS.filter((p) => parseBars(p.numerals).length === 4);
      const p = pick(candidates);
      const key = pick(p.key.endsWith('m') ? ['Am', 'Em', 'Dm', 'Cm'] : ['C', 'G', 'F', 'D', 'Bb']);
      const chords = progressionToChords(p.numerals, key).map((c) => c.symbol);
      const label = (num: string) => parseBars(num).map((c) => c.symbol).join(' – ');
      const answer = label(p.numerals);
      const pool = candidates.filter((x) => x.key.endsWith('m') === p.key.endsWith('m')).map((x) => label(x.numerals));
      return {
        prompt: chords.map(prettyChord).join(' – '),
        sub: `조성: ${key} — 로마숫자로 분석하면?`,
        kind: 'choice',
        choices: choicesWith(answer, [...new Set(pool)]),
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
    make: () => {
      const ps = FAMOUS.map((id) => PROGRESSIONS.find((p) => p.id === id)!).filter(Boolean);
      const p = pick(ps);
      const chords = progressionToChords(p.numerals, p.key).map((c) => c.symbol);
      const groups = voiceProgression(chords).map((v) => [v.bass, ...v.rh]);
      return {
        prompt: '이 진행의 이름은?',
        kind: 'choice',
        choices: choicesWith(p.name, ps.map((x) => x.name)),
        answer: p.name,
        play: () => playSequence(groups, 1.1, 1.05),
        replayLabel: '다시 듣기',
        explain: `${p.numerals} — ${p.description}`,
      };
    },
  },
];

export const QUESTIONS_PER_STAGE = 8;
export const HEARTS = 3;

export function starsFor(mistakes: number) {
  return mistakes === 0 ? 3 : mistakes === 1 ? 2 : 1;
}
