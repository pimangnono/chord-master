export type Part =
  | 'chord' // right-hand voicing
  | 'bass' // left-hand bass note
  | 'bass5' // fifth above the bass
  | 'bass8' // bass an octave up
  | 'shell' // LH root + 7th (or 3rd)
  | 'walk' // walking bass, one note per beat
  | `arp${number}`; // single RH voicing note (index wraps)

export interface PatternEvent {
  /** start in beats from the start of the pattern */
  t: number;
  /** length in beats */
  d: number;
  part: Part;
  vel?: number;
  /** plays the *next* chord early (anticipation / push) */
  push?: boolean;
}

export type DrumInst = 'kick' | 'snare' | 'hat' | 'openhat' | 'rim' | 'shaker' | 'ride';

export interface DrumHit {
  t: number;
  inst: DrumInst;
  vel?: number;
}

export interface RhythmPattern {
  id: string;
  name: string;
  genre: 'basic' | 'pop' | 'kpop' | 'jazz' | 'bossa' | 'hiphop' | 'retro';
  /** pattern length in beats (4 = one bar, 8 = two bars) */
  length: number;
  /** 0 = straight, 1 = full triplet swing on the 8th notes (or 16ths when swing16) */
  swing?: number;
  swing16?: boolean;
  description: string;
  tips: string[];
  events: PatternEvent[];
  drums?: DrumHit[];
}

const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t < to - 1e-9; t += step) out.push(+t.toFixed(4));
  return out;
};

const ROCK_DRUMS: DrumHit[] = [
  { t: 0, inst: 'kick' },
  { t: 2, inst: 'kick' },
  { t: 2.5, inst: 'kick', vel: 0.6 },
  { t: 1, inst: 'snare' },
  { t: 3, inst: 'snare' },
  ...range(0, 4, 0.5).map((t) => ({ t, inst: 'hat' as const, vel: t % 1 ? 0.45 : 0.7 })),
];

export const RHYTHMS: RhythmPattern[] = [
  {
    id: 'whole',
    name: '온음표 블록 코드',
    genre: 'basic',
    length: 4,
    description: '코드가 바뀔 때 한 번만 누르고 길게 유지해요. 코드 모양을 익히는 첫 단계입니다.',
    tips: ['왼손은 베이스(근음), 오른손은 3~4음 코드', '코드가 바뀔 때 손가락 이동을 최소화하는 보이싱을 연습하세요'],
    events: [
      { t: 0, d: 4, part: 'bass', vel: 0.65 },
      { t: 0, d: 4, part: 'chord', vel: 0.55 },
    ],
  },
  {
    id: 'quarter',
    name: '4분음표 블록 코드',
    genre: 'basic',
    length: 4,
    description: '오른손이 한 박마다 코드를 칩니다. 박자감과 코드 전환 연습에 좋아요.',
    tips: ['1박과 3박에 살짝 악센트', '왼손은 2박씩 근음 → 5음'],
    events: [
      { t: 0, d: 2, part: 'bass', vel: 0.65 },
      { t: 2, d: 2, part: 'bass5', vel: 0.55 },
      ...[0, 1, 2, 3].map((t) => ({ t, d: 0.9, part: 'chord' as const, vel: t % 2 ? 0.45 : 0.6 })),
    ],
    drums: [
      { t: 0, inst: 'kick' },
      { t: 2, inst: 'kick' },
      { t: 1, inst: 'snare' },
      { t: 3, inst: 'snare' },
    ],
  },
  {
    id: 'pop8',
    name: '팝 8비트',
    genre: 'pop',
    length: 4,
    description: '오른손이 8분음표로 일정하게 코드를 연주하는 가장 대중적인 팝 반주입니다.',
    tips: ['정박(1,2,3,4)을 조금 더 세게, 엇박은 가볍게', '왼손은 근음을 2분음표로'],
    events: [
      { t: 0, d: 2, part: 'bass', vel: 0.7 },
      { t: 2, d: 2, part: 'bass', vel: 0.6 },
      ...range(0, 4, 0.5).map((t) => ({ t, d: 0.45, part: 'chord' as const, vel: t % 1 ? 0.38 : 0.55 })),
    ],
    drums: ROCK_DRUMS,
  },
  {
    id: 'ballad-arp',
    name: '발라드 아르페지오',
    genre: 'pop',
    length: 4,
    description: '왼손 1-5-8 펼침화음 위에 오른손이 코드 음을 하나씩 펼칩니다. 발라드·OST 반주의 기본.',
    tips: ['페달을 코드가 바뀔 때마다 갈아 밟으세요', '왼손 1-5-8 은 손 모양을 고정한 채 펼치기'],
    events: [
      { t: 0, d: 4, part: 'bass', vel: 0.6 },
      { t: 0.5, d: 3.5, part: 'bass5', vel: 0.4 },
      { t: 1, d: 3, part: 'bass8', vel: 0.42 },
      { t: 1.5, d: 2.5, part: 'arp0', vel: 0.45 },
      { t: 2, d: 2, part: 'arp1', vel: 0.48 },
      { t: 2.5, d: 1.5, part: 'arp2', vel: 0.5 },
      { t: 3, d: 1, part: 'arp1', vel: 0.42 },
      { t: 3.5, d: 0.5, part: 'arp0', vel: 0.4 },
    ],
  },
  {
    id: 'kpop-332',
    name: 'K-pop 3-3-2 싱코페이션',
    genre: 'kpop',
    length: 4,
    description: '8분음표 기준 3+3+2로 끊어 치는 리듬. K-pop 댄스·미디엄 템포 곡에서 아주 흔해요.',
    tips: ['“쿵–따–쿵” 이 아니라 “1, 2&, 4” 위치를 정확히', '베이스도 같은 리듬으로 맞추면 그루브가 단단해져요'],
    events: [
      { t: 0, d: 1.25, part: 'bass', vel: 0.7 },
      { t: 1.5, d: 1.25, part: 'bass', vel: 0.6 },
      { t: 3, d: 0.9, part: 'bass8', vel: 0.55 },
      { t: 0, d: 1.25, part: 'chord', vel: 0.6 },
      { t: 1.5, d: 1.25, part: 'chord', vel: 0.55 },
      { t: 3, d: 0.9, part: 'chord', vel: 0.5 },
    ],
    drums: [
      { t: 0, inst: 'kick' },
      { t: 1.5, inst: 'kick', vel: 0.7 },
      { t: 2.5, inst: 'kick', vel: 0.5 },
      { t: 1, inst: 'snare' },
      { t: 3, inst: 'snare' },
      ...range(0, 4, 0.25).map((t) => ({ t, inst: 'hat' as const, vel: t % 0.5 ? 0.25 : 0.5 })),
    ],
  },
  {
    id: 'kpop-ballad',
    name: 'K-발라드 16비트',
    genre: 'kpop',
    length: 4,
    description: '왼손은 길게, 오른손은 16분음표 느낌으로 코드를 쪼개는 K-발라드 피아노 스타일.',
    tips: ['오른손 엄지(아래 음)와 나머지 손가락을 번갈아', '후렴에서는 왼손을 옥타브로 강화'],
    events: [
      { t: 0, d: 2, part: 'bass', vel: 0.65 },
      { t: 0, d: 2, part: 'bass8', vel: 0.4 },
      { t: 2, d: 2, part: 'bass5', vel: 0.5 },
      { t: 0, d: 0.75, part: 'chord', vel: 0.5 },
      { t: 0.75, d: 0.25, part: 'arp0', vel: 0.35 },
      { t: 1, d: 0.5, part: 'chord', vel: 0.42 },
      { t: 1.5, d: 0.5, part: 'arp2', vel: 0.38 },
      { t: 2, d: 0.75, part: 'chord', vel: 0.48 },
      { t: 2.75, d: 0.25, part: 'arp0', vel: 0.35 },
      { t: 3, d: 0.5, part: 'chord', vel: 0.42 },
      { t: 3.5, d: 0.5, part: 'arp1', vel: 0.38 },
    ],
  },
  {
    id: 'charleston',
    name: '재즈 찰스턴 컴핑',
    genre: 'jazz',
    length: 4,
    swing: 1,
    description: '1박과 2박 뒷박(“1, 2&”)에 코드를 짧게 찍는 재즈 컴핑 + 4분음표 워킹 베이스.',
    tips: ['스윙: 8분음표를 “길–짧” 셋잇단 느낌으로', '코드는 짧게(스타카토) 찍어야 베이스가 들려요', '워킹 베이스의 마지막 박은 다음 코드로 반음 접근'],
    events: [
      { t: 0, d: 1, part: 'walk', vel: 0.62 },
      { t: 1, d: 1, part: 'walk', vel: 0.55 },
      { t: 2, d: 1, part: 'walk', vel: 0.6 },
      { t: 3, d: 1, part: 'walk', vel: 0.55 },
      { t: 0, d: 0.6, part: 'chord', vel: 0.5 },
      { t: 1.5, d: 0.4, part: 'chord', vel: 0.45 },
    ],
    drums: [
      ...[0, 1, 1.5, 2, 3, 3.5].map((t) => ({ t, inst: 'ride' as const, vel: Number.isInteger(t) ? 0.5 : 0.35 })),
      { t: 1, inst: 'hat', vel: 0.4 },
      { t: 3, inst: 'hat', vel: 0.4 },
    ],
  },
  {
    id: 'jazz-ballad',
    name: '재즈 발라드 (셸 보이싱)',
    genre: 'jazz',
    length: 4,
    swing: 0.6,
    description: '왼손은 근음+7음 셸 보이싱, 오른손은 코드 톤을 부드럽게. 느린 스탠더드 반주.',
    tips: ['왼손 셸(1-7 또는 1-3)만으로도 코드 성격이 드러나요', '오른손은 3·7·9음 위주로'],
    events: [
      { t: 0, d: 4, part: 'shell', vel: 0.55 },
      { t: 0.5, d: 3.5, part: 'chord', vel: 0.42 },
      { t: 2.5, d: 1.5, part: 'arp3', vel: 0.35 },
    ],
    drums: range(0, 4, 0.5).map((t) => ({ t, inst: 'shaker' as const, vel: 0.2 })),
  },
  {
    id: 'bossa',
    name: '보사노바 (2마디 클라베)',
    genre: 'bossa',
    length: 8,
    description: '베이스는 “근음–5음” 반복, 코드는 보사노바 클라베 리듬(2마디)으로 엇갈려 칩니다.',
    tips: ['베이스: 1박 근음(점4분) + 2박 뒷박 5음, 3박 5음 + 4박 뒷박 근음', '코드 리듬은 2마디 단위로 생각하세요', '세게 치지 말고 기타처럼 가볍게'],
    events: [
      ...[0, 4].flatMap((o) => [
        { t: o, d: 1.5, part: 'bass' as const, vel: 0.6 },
        { t: o + 1.5, d: 0.5, part: 'bass5' as const, vel: 0.45 },
        { t: o + 2, d: 1.5, part: 'bass5' as const, vel: 0.55 },
        { t: o + 3.5, d: 0.5, part: 'bass' as const, vel: 0.45 },
      ]),
      { t: 0, d: 0.75, part: 'chord', vel: 0.45 },
      { t: 1.5, d: 0.75, part: 'chord', vel: 0.42 },
      { t: 3, d: 0.75, part: 'chord', vel: 0.42 },
      { t: 5, d: 0.75, part: 'chord', vel: 0.42 },
      { t: 6.5, d: 1.5, part: 'chord', vel: 0.42 },
    ],
    drums: [
      ...[0, 1.5, 3, 5, 6.5].map((t) => ({ t, inst: 'rim' as const, vel: 0.45 })),
      ...range(0, 8, 0.5).map((t) => ({ t, inst: 'shaker' as const, vel: t % 1 ? 0.2 : 0.3 })),
      ...[0, 1.5, 2, 3.5, 4, 5.5, 6, 7.5].map((t) => ({ t, inst: 'kick' as const, vel: 0.4 })),
    ],
  },
  {
    id: 'lofi',
    name: '로파이 힙합',
    genre: 'hiphop',
    length: 4,
    swing: 0.55,
    swing16: true,
    description: '느슨하게 늘어진(스윙된) 16비트 위에 확장 코드를 길게. 로파이·네오소울 감성.',
    tips: ['코드를 살짝 늦게(레이백) 치는 느낌', '9th·13th 같은 텐션을 오른손 위쪽에', '킥·스네어는 정박, 하이햇만 스윙'],
    events: [
      { t: 0, d: 1.5, part: 'bass', vel: 0.65 },
      { t: 2.5, d: 1, part: 'bass', vel: 0.5 },
      { t: 0, d: 2.75, part: 'chord', vel: 0.45 },
      { t: 3, d: 0.75, part: 'chord', vel: 0.3 },
    ],
    drums: [
      { t: 0, inst: 'kick' },
      { t: 0.75, inst: 'kick', vel: 0.5 },
      { t: 2.5, inst: 'kick', vel: 0.8 },
      { t: 1, inst: 'snare', vel: 0.7 },
      { t: 3, inst: 'snare', vel: 0.7 },
      ...range(0, 4, 0.5).map((t) => ({ t, inst: 'hat' as const, vel: 0.3 })),
    ],
  },
  {
    id: 'boombap',
    name: '붐뱁 스탭',
    genre: 'hiphop',
    length: 4,
    swing: 0.35,
    swing16: true,
    description: '샘플을 잘라 쓰듯 코드를 짧게 끊어 치는 90년대 붐뱁 스타일.',
    tips: ['코드는 아주 짧게(스탭)', '킥 패턴과 베이스를 맞추면 단단해져요'],
    events: [
      { t: 0, d: 0.75, part: 'bass', vel: 0.7 },
      { t: 1.75, d: 0.5, part: 'bass', vel: 0.55 },
      { t: 2.5, d: 1, part: 'bass', vel: 0.6 },
      { t: 0, d: 0.3, part: 'chord', vel: 0.55 },
      { t: 1.75, d: 0.25, part: 'chord', vel: 0.45 },
      { t: 2.5, d: 0.5, part: 'chord', vel: 0.5 },
    ],
    drums: [
      { t: 0, inst: 'kick' },
      { t: 1.75, inst: 'kick', vel: 0.7 },
      { t: 2.5, inst: 'kick' },
      { t: 1, inst: 'snare' },
      { t: 3, inst: 'snare' },
      ...range(0, 4, 0.5).map((t) => ({ t, inst: 'hat' as const, vel: 0.35 })),
    ],
  },
  {
    id: 'trap',
    name: '트랩 패드',
    genre: 'hiphop',
    length: 4,
    description: '코드는 패드처럼 길게, 808 베이스가 리듬을 담당. 하이햇 16비트(롤 포함).',
    tips: ['스네어(클랩)는 3박에만 — 하프타임 느낌', '어두운 단조 루프가 잘 어울려요'],
    events: [
      { t: 0, d: 4, part: 'chord', vel: 0.35 },
      { t: 0, d: 1.5, part: 'bass', vel: 0.75 },
      { t: 2.75, d: 1.25, part: 'bass', vel: 0.65 },
    ],
    drums: [
      { t: 0, inst: 'kick' },
      { t: 2.75, inst: 'kick', vel: 0.8 },
      { t: 2, inst: 'snare' },
      ...range(0, 3, 0.25).map((t) => ({ t, inst: 'hat' as const, vel: 0.3 })),
      ...range(3, 4, 0.125).map((t) => ({ t, inst: 'hat' as const, vel: 0.25 })),
    ],
  },
  {
    id: 'shuffle',
    name: '50s 셔플 (두왑)',
    genre: 'retro',
    length: 4,
    swing: 1,
    description: '셋잇단 느낌으로 튕기는 50년대 두왑·로큰롤 반주. 8분음표를 “길–짧”으로.',
    tips: ['8분음표 두 개를 “따–앗따” 셋잇단 2:1로', '왼손은 근음–5음–6음 부기 패턴으로 응용 가능'],
    events: [
      { t: 0, d: 1, part: 'bass', vel: 0.65 },
      { t: 1, d: 1, part: 'bass5', vel: 0.5 },
      { t: 2, d: 1, part: 'bass8', vel: 0.55 },
      { t: 3, d: 1, part: 'bass5', vel: 0.5 },
      ...range(0, 4, 0.5).map((t) => ({ t, d: 0.4, part: 'chord' as const, vel: t % 1 ? 0.32 : 0.48 })),
    ],
    drums: [
      { t: 0, inst: 'kick' },
      { t: 2, inst: 'kick' },
      { t: 1, inst: 'snare', vel: 0.7 },
      { t: 3, inst: 'snare', vel: 0.7 },
      ...range(0, 4, 0.5).map((t) => ({ t, inst: 'ride' as const, vel: 0.35 })),
    ],
  },
  {
    id: 'disco',
    name: '70s 디스코·펑크',
    genre: 'retro',
    length: 4,
    description: '옥타브를 오가는 디스코 베이스 + 16분 엇박 코드 스탭. 4-on-the-floor 킥.',
    tips: ['베이스는 “근음–옥타브” 8분음표 반복', '코드는 엇박에 짧게 끊어서'],
    events: [
      ...range(0, 4, 0.5).map((t) => ({ t, d: 0.4, part: (t % 1 ? 'bass8' : 'bass') as Part, vel: 0.6 })),
      { t: 0.5, d: 0.25, part: 'chord', vel: 0.45 },
      { t: 1.25, d: 0.25, part: 'chord', vel: 0.4 },
      { t: 2.5, d: 0.25, part: 'chord', vel: 0.45 },
      { t: 3.25, d: 0.5, part: 'chord', vel: 0.4 },
    ],
    drums: [
      ...[0, 1, 2, 3].map((t) => ({ t, inst: 'kick' as const })),
      { t: 1, inst: 'snare', vel: 0.7 },
      { t: 3, inst: 'snare', vel: 0.7 },
      ...[0.5, 1.5, 2.5, 3.5].map((t) => ({ t, inst: 'openhat' as const, vel: 0.35 })),
    ],
  },
  {
    id: 'citypop',
    name: '80s 시티팝',
    genre: 'retro',
    length: 4,
    description: '당김음(앞당겨 치기)이 특징인 시티팝 반주. 4박 뒷박에서 다음 코드를 미리 칩니다.',
    tips: ['4박 뒷박에서 다음 코드를 “미리” — 푸시(anticipation)', '메이저7·마이너7 코드가 잘 어울려요'],
    events: [
      { t: 0, d: 0.75, part: 'bass', vel: 0.65 },
      { t: 0.75, d: 0.25, part: 'bass8', vel: 0.45 },
      { t: 1.5, d: 1, part: 'bass', vel: 0.55 },
      { t: 2.75, d: 0.75, part: 'bass5', vel: 0.5 },
      { t: 0, d: 1, part: 'chord', vel: 0.5 },
      { t: 1.5, d: 0.5, part: 'chord', vel: 0.42 },
      { t: 2.5, d: 0.5, part: 'chord', vel: 0.42 },
      { t: 3.5, d: 0.5, part: 'chord', vel: 0.5, push: true },
    ],
    drums: [
      { t: 0, inst: 'kick' },
      { t: 1.5, inst: 'kick', vel: 0.6 },
      { t: 2, inst: 'kick' },
      { t: 1, inst: 'snare', vel: 0.7 },
      { t: 3, inst: 'snare', vel: 0.7 },
      ...range(0, 4, 0.25).map((t) => ({ t, inst: 'hat' as const, vel: t % 0.5 ? 0.18 : 0.35 })),
    ],
  },
];

export const RHYTHM_BY_ID: Record<string, RhythmPattern> = Object.fromEntries(RHYTHMS.map((r) => [r.id, r]));

export function getRhythm(id: string | undefined): RhythmPattern {
  return (id && RHYTHM_BY_ID[id]) || RHYTHM_BY_ID.pop8;
}
