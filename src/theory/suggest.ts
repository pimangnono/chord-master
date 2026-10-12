import { Chord, Note } from 'tonal';
import { parseKey } from './keys';
import { splitSlash } from './notes';
import { ChordEvent, chordToRoman, romanToChord } from './roman';

export type Style = 'pop' | 'kpop' | 'jazz' | 'bossa' | 'hiphop';

export interface Suggestion {
  symbol: string;
  numeral: string;
  score: number;
  reasons: string[];
}

type Rule = [numeral: string, weight: number, reason: string];

/** Function token: semitones from tonic + rough quality. */
export function chordToken(symbol: string, key: string): string | undefined {
  const [main] = splitSlash(symbol);
  const c = Chord.get(main);
  if (c.empty || !c.tonic) return undefined;
  const semis = ((Note.chroma(c.tonic)! - Note.chroma(parseKey(key).tonic)! + 12) % 12);
  let q = 'M';
  if (c.intervals.includes('3M') && c.intervals.includes('7m')) q = 'D7';
  else if (c.quality === 'Minor') q = 'm';
  else if (c.quality === 'Diminished') q = 'o';
  else if (c.quality === 'Augmented') q = '+';
  return `${semis}:${q}`;
}

const MAJOR_RULES: Record<string, Rule[]> = {
  '0:M': [
    ['IV', 0.9, '토닉 → 서브도미넌트: 가장 자연스러운 출발'],
    ['V', 0.85, '토닉 → 도미넌트: 긴장감을 만들어요'],
    ['vi', 0.8, '나란한조 vi로 감성적인 전환 (I–vi)'],
    ['ii', 0.65, 'ii–V–I을 준비하는 움직임'],
    ['iii', 0.35, '베이스가 3도 올라가는 부드러운 연결'],
    ['I7', 0.35, 'I7은 IV로 가는 부속 도미넌트'],
    ['bVII', 0.3, '믹솔리디안 bVII 빌림 (록 느낌)'],
  ],
  '0:D7': [
    ['IV', 0.9, 'I7 = V7/IV: IV로 해결'],
    ['iv', 0.4, 'I7 → iv: 블루지한 하행'],
  ],
  '2:m': [
    ['V7', 0.95, 'ii–V: 재즈·팝의 기본 공식'],
    ['bII7', 0.4, '트라이톤 대리: 베이스 반음 하행'],
    ['iii', 0.35, '순차 상행 ii → iii'],
    ['I/5', 0.3, '베이스를 유지하는 변형 진행'],
  ],
  '2:D7': [
    ['V7', 0.9, 'II7 = V7/V: 도미넌트로 해결'],
    ['ii7', 0.5, 'II7 → ii7: 같은 근음 단조화 (Ipanema 진행)'],
  ],
  '4:m': [
    ['vi', 0.85, '5도 하행 (iii → vi)'],
    ['IV', 0.6, 'iii → IV: 순차 상행'],
    ['VI7', 0.4, 'VI7 = V7/ii: ii로 끌어당기기'],
    ['ii', 0.35, '하행 연결 iii → ii'],
  ],
  '4:D7': [
    ['vi', 0.9, 'III7 = V7/vi: vi로 해결 (K-pop 단골)'],
    ['IV', 0.35, '거짓 해결: III7 → IV'],
  ],
  '5:M': [
    ['V', 0.9, 'S → D: 가장 기본적인 흐름'],
    ['I', 0.75, '변격종지 (아멘 종지)'],
    ['iv', 0.6, '마이너 iv 빌림: 애틋한 색채'],
    ['iii', 0.5, '왕도진행 IV → iii (하행)'],
    ['ii', 0.4, '하행 연결 IV → ii'],
    ['III7', 0.35, 'IV → III7 → vi (Just the Two of Us 진행)'],
  ],
  '5:m': [
    ['I', 0.85, '마이너 플라갈 종지 (iv → I)'],
    ['bVII7', 0.5, '백도어 ii–V (iv7 → bVII7 → I)'],
    ['V7', 0.45, 'iv → V7'],
  ],
  '7:M': [
    ['I', 0.95, '정격종지: 가장 강한 해결'],
    ['vi', 0.7, '거짓종지 (기만종지)'],
    ['iii', 0.45, '왕도진행 V → iii'],
    ['IV', 0.4, '록 스타일 역행 (V → IV)'],
  ],
  '7:D7': [
    ['I', 0.95, '정격종지: V7 → I 해결'],
    ['vi', 0.7, '거짓종지 (기만종지)'],
    ['iii', 0.35, 'V7 → iii (왕도진행 계열)'],
  ],
  '9:m': [
    ['IV', 0.85, '감성 팝: vi–IV–I–V'],
    ['ii', 0.7, '5도 하행 vi–ii–V–I'],
    ['V', 0.55, 'vi → V: 하행 베이스'],
    ['iii', 0.4, 'vi → iii (캐논풍)'],
  ],
  '9:D7': [['ii', 0.9, 'VI7 = V7/ii: ii로 해결']],
  '11:o': [
    ['I', 0.9, '이끈음 해결 vii° → I'],
    ['iii', 0.35, 'vii° → iii'],
  ],
  '10:M': [
    ['I', 0.8, '믹솔리디안 종지 (bVII → I)'],
    ['IV', 0.6, '록 진행 bVII–IV–I'],
  ],
  '10:D7': [['I', 0.85, '백도어 도미넌트 bVII7 → I']],
  '8:M': [
    ['bVII', 0.8, '에픽 종지 bVI–bVII–I'],
    ['V', 0.4, 'bVI → V'],
  ],
  '1:D7': [['I', 0.9, '트라이톤 대리 bII7 → I']],
};

const MINOR_RULES: Record<string, Rule[]> = {
  '0:m': [
    ['iv', 0.8, 'i → iv: 단조의 기본 움직임'],
    ['bVI', 0.8, 'i → bVI: 에픽·발라드 루프'],
    ['bVII', 0.75, 'i → bVII: 자연단음계 하행'],
    ['V7', 0.65, 'i → V7: 긴장감 만들기'],
    ['iiø7', 0.55, '마이너 ii–V 준비'],
    ['bIII', 0.45, '나란한조 장조로 밝게'],
  ],
  '2:o': [['V7', 0.95, '마이너 ii–V: iiø7 → V7']],
  '3:M': [
    ['bVI', 0.7, 'bIII → bVI (5도 하행)'],
    ['bVII', 0.6, 'bIII → bVII'],
    ['iv', 0.55, 'bIII → iv'],
  ],
  '5:m': [
    ['V7', 0.7, 'iv → V7 → i'],
    ['i', 0.65, '단조 플라갈 종지'],
    ['bVII', 0.55, 'iv → bVII (5도 하행)'],
  ],
  '7:D7': [
    ['i', 0.95, '단조 정격종지 V7 → i'],
    ['bVI', 0.6, '거짓종지 V7 → bVI'],
  ],
  '7:M': [
    ['i', 0.9, '안달루시아 종지의 마지막 V → i'],
    ['bVI', 0.5, '거짓종지 V → bVI'],
  ],
  '7:m': [
    ['i', 0.6, 'v → i (자연단음계)'],
    ['bVI', 0.6, 'v → bVI'],
  ],
  '8:M': [
    ['bVII', 0.8, 'bVI → bVII → i (에픽 종지)'],
    ['V7', 0.6, 'bVI → V7 (안달루시아/발라드)'],
    ['bIII', 0.45, 'bVI → bIII'],
  ],
  '10:M': [
    ['i', 0.75, 'bVII → i (에올리안 종지)'],
    ['bIII', 0.65, 'bVII → bIII (5도 하행)'],
    ['bVI', 0.45, '하행 안달루시아 (i–bVII–bVI–V)'],
  ],
  '1:M': [['V7', 0.8, '나폴리 화음 bII → V7']],
};

const SEVENTH_MAP_MAJOR: Record<string, string> = { I: 'Imaj7', ii: 'ii7', iii: 'iii7', IV: 'IVmaj7', V: 'V7', vi: 'vi7', 'vii°': 'viiø7', iv: 'iv7', bVII: 'bVII7', bVI: 'bVImaj7' };
const SEVENTH_MAP_MINOR: Record<string, string> = { i: 'i7', iv: 'iv7', v: 'v7', bVI: 'bVImaj7', bVII: 'bVII7', bIII: 'bIIImaj7', 'ii°': 'iiø7' };

export type TransitionStats = Map<string, Map<string, number>>;

/** Counts which chord (as a numeral in each piece's key) follows which function token. */
export function buildTransitionStats(corpus: { key: string; chords: ChordEvent[] }[]): TransitionStats {
  const stats: TransitionStats = new Map();
  for (const piece of corpus) {
    const n = piece.chords.length;
    for (let i = 0; i < n; i++) {
      const a = piece.chords[i].symbol;
      const b = piece.chords[(i + 1) % n].symbol;
      if (a === b) continue;
      const tok = chordToken(a, piece.key);
      if (!tok) continue;
      const mode = parseKey(piece.key).minor ? 'm|' : 'M|';
      const numeral = chordToRoman(splitSlash(b)[0], piece.key);
      const row = stats.get(mode + tok) ?? new Map<string, number>();
      row.set(numeral, (row.get(numeral) ?? 0) + 1);
      stats.set(mode + tok, row);
    }
  }
  return stats;
}

export function suggestNext(current: string, key: string, opts: { style?: Style; stats?: TransitionStats; limit?: number } = {}): Suggestion[] {
  const { minor } = parseKey(key);
  const tok = chordToken(current, key);
  if (!tok) return [];
  const sevenths = opts.style === 'jazz' || opts.style === 'bossa' || opts.style === 'hiphop';
  const merged = new Map<string, Suggestion>();
  const add = (numeral: string, weight: number, reason: string) => {
    let n = numeral;
    if (sevenths) n = (minor ? SEVENTH_MAP_MINOR : SEVENTH_MAP_MAJOR)[numeral] ?? numeral;
    const symbol = romanToChord(n, key);
    if (splitSlash(symbol)[0] === splitSlash(current)[0]) return;
    const prevS = merged.get(symbol);
    if (prevS) {
      prevS.score = Math.max(prevS.score, weight) + Math.min(weight, prevS.score) * 0.25;
      if (!prevS.reasons.includes(reason)) prevS.reasons.push(reason);
    } else {
      merged.set(symbol, { symbol, numeral: n, score: weight, reasons: [reason] });
    }
  };

  const rules = (minor ? MINOR_RULES : MAJOR_RULES)[tok];
  if (rules) for (const [n, w, r] of rules) add(n, w, r);

  // Any dominant chord wants to resolve down a fifth (or a half step for tritone subs).
  const [main] = splitSlash(current);
  const c = Chord.get(main);
  if (c.tonic && c.intervals.includes('3M') && c.intervals.includes('7m')) {
    const target = Note.pitchClass(Note.transpose(c.tonic, '-5P'));
    const tRoman = chordToRoman(target, key);
    const diatonicMinor = minor ? ['iv', 'v', 'i'] : ['ii', 'iii', 'vi'];
    const numeral = diatonicMinor.includes(tRoman.toLowerCase()) ? tRoman.toLowerCase() : tRoman;
    add(numeral, 0.8, '도미넌트 7th는 완전5도 아래로 해결하려는 성질이 있어요');
  }

  if (opts.stats) {
    const row = opts.stats.get((minor ? 'm|' : 'M|') + tok);
    if (row) {
      const max = Math.max(...row.values());
      for (const [numeral, count] of [...row.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        add(numeral, 0.25 + 0.45 * (count / max), `앱 수록 진행·노래에서 ${count}번 등장`);
      }
    }
  }

  if (opts.style === 'jazz' || opts.style === 'bossa') {
    const top = [...merged.values()].sort((a, b) => b.score - a.score)[0];
    const tc = top && Chord.get(splitSlash(top.symbol)[0]);
    if (tc?.tonic) {
      const dom = Note.pitchClass(Note.transpose(tc.tonic, '5P')) + '7';
      const tri = Note.pitchClass(Note.transpose(tc.tonic, '2m')) + '7';
      for (const [sym, why] of [
        [dom, `${top.symbol}로 가기 전 부속 도미넌트를 끼워 긴장감 추가`],
        [tri, `${top.symbol}로 반음 하행하는 트라이톤 대리`],
      ]) {
        if (!merged.has(sym) && splitSlash(current)[0] !== sym) {
          merged.set(sym, { symbol: sym, numeral: chordToRoman(sym, key), score: 0.3, reasons: [why] });
        }
      }
    }
  }

  if (!merged.size) {
    add(minor ? 'i' : 'I', 0.3, '조성 밖의 코드 → 으뜸화음으로 돌아가기');
    add('V7', 0.3, '도미넌트로 다시 긴장 만들기');
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 6);
}
