import { Chord, Interval, Note } from 'tonal';
import { alterNote, parseKey, transposeNote } from './keys';
import { splitSlash } from './notes';

const DEGREE_IVL = ['1P', '2M', '3M', '4P', '5P', '6M', '7M'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const NUMERAL_RE = /^([b#]*)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/;

export interface ChordEvent {
  symbol: string;
  beats: number;
  /** words sung on this chord (songs added from a chord sheet with lyrics) */
  lyric?: string;
}

function degreeIndex(roman: string): number {
  return ROMAN.indexOf(roman.toUpperCase());
}

function accDelta(acc: string): number {
  let d = 0;
  for (const ch of acc) d += ch === '#' ? 1 : -1;
  return d;
}

/** Root note of a scale degree of `tonic` (major-scale reference, e.g. "bVII"). */
function degreeRoot(tonic: string, acc: string, roman: string): string {
  const idx = degreeIndex(roman);
  const root = Note.transpose(tonic, DEGREE_IVL[idx]);
  return Note.pitchClass(alterNote(root, accDelta(acc)));
}

function suffixToChordType(suffix: string, lower: boolean): string {
  let s = suffix.replace(/^o/, '°').replace(/^M7/, 'maj7');
  if (s.startsWith('°')) return s === '°' ? 'dim' : 'dim' + s.slice(1);
  if (s.startsWith('ø')) return 'm7b5';
  if (!lower) return s.replace(/^\+$/, 'aug').replace(/^\+/, 'aug');
  if (s.startsWith('maj')) return 'mMaj' + s.slice(3);
  return 'm' + s;
}

/**
 * Converts a roman numeral to a chord symbol in a key.
 *   romanToChord("ii7", "C")    → "Dm7"
 *   romanToChord("bVIImaj7","C")→ "Bbmaj7"
 *   romanToChord("V7/vi", "C")  → "E7"
 *   romanToChord("V/7", "C")    → "G/B"   (bass on scale degree 7)
 */
export function romanToChord(numeral: string, key: string): string {
  const { tonic } = parseKey(key);
  const [head, slash] = splitNumeralSlash(numeral);
  const m = head.match(NUMERAL_RE);
  if (!m) return numeral;
  const [, acc, roman, suffix] = m;
  const lower = roman === roman.toLowerCase();
  const type = suffixToChordType(suffix, lower);

  if (slash && NUMERAL_RE.test(slash) && !/^[b#]*\d+$/.test(slash)) {
    // Secondary function: chord is built on `roman` of the target's major key.
    const t = slash.match(NUMERAL_RE)!;
    const targetRoot = degreeRoot(tonic, t[1], t[2]);
    const root = degreeRoot(targetRoot, acc, roman);
    return tidy(root) + type;
  }

  // Chromatic roots are respelled the way lead sheets write them (bII7 in Eb → E7, not Fb7).
  const raw = tidy(degreeRoot(tonic, acc, roman));
  const root = acc && /^(Fb|Cb|E#|B#)$/.test(raw) ? Note.simplify(raw) : raw;
  let symbol = root + type;
  if (slash) {
    const b = slash.match(/^([b#]*)(\d)$/);
    if (b) {
      const bass = tidy(Note.pitchClass(alterNote(Note.transpose(tonic, DEGREE_IVL[(+b[2] - 1) % 7]), accDelta(b[1]))));
      if (bass !== root) symbol += '/' + bass;
    }
  }
  return symbol;
}

function tidy(pc: string): string {
  return transposeNote(pc, '1P');
}

function splitNumeralSlash(numeral: string): [string, string | undefined] {
  const i = numeral.indexOf('/');
  if (i < 0) return [numeral, undefined];
  return [numeral.slice(0, i), numeral.slice(i + 1)];
}

function degreeFromInterval(ivl: string): { acc: string; idx: number } {
  const iv = Interval.get(ivl);
  const num = ((((iv.num ?? 1) - 1) % 7) + 7) % 7;
  const q = iv.q;
  const perfect = num === 0 || num === 3 || num === 4;
  let acc = '';
  if (perfect) {
    if (q === 'd') acc = 'b';
    else if (q === 'dd') acc = 'bb';
    else if (q === 'A') acc = '#';
  } else {
    if (q === 'm') acc = 'b';
    else if (q === 'd') acc = 'bb';
    else if (q === 'A') acc = '#';
  }
  return { acc, idx: num };
}

export function isMinorish(symbol: string): boolean {
  const [main] = splitSlash(symbol);
  const c = Chord.get(main);
  return c.quality === 'Minor' || c.quality === 'Diminished';
}

/** Roman numeral of a chord symbol in a key: chordToRoman("Dm7","C") → "ii7". */
export function chordToRoman(symbol: string, key: string): string {
  const { tonic } = parseKey(key);
  const [main, bass] = splitSlash(symbol);
  const m = main.match(/^([A-G][#b]*)(.*)$/);
  if (!m) return '?';
  const [, root, suffix] = m;
  const { acc, idx } = degreeFromInterval(Interval.distance(tonic, root));
  const minorish = isMinorish(main);
  let roman = ROMAN[idx];
  let suf = suffix;
  if (minorish) {
    roman = roman.toLowerCase();
    if (/^(m7b5|min7b5|ø)/.test(suf)) suf = 'ø7' + suf.replace(/^(m7b5|min7b5|ø7?)/, '');
    else if (/^dim/.test(suf)) suf = '°' + suf.slice(3);
    else if (/^(mMaj|mmaj|mM)/.test(suf)) suf = 'maj' + suf.replace(/^(mMaj|mmaj|mM)/, '');
    else if (/^min/.test(suf)) suf = suf.slice(3);
    else if (/^m/.test(suf)) suf = suf.slice(1);
  } else {
    suf = suf.replace(/^aug/, '+').replace(/^M7/, 'maj7').replace(/^M9/, 'maj9');
  }
  let out = acc + roman + suf;
  if (bass) {
    const b = degreeFromInterval(Interval.distance(tonic, bass));
    out += '/' + b.acc + (b.idx + 1);
  }
  return out;
}

const DOMINANT_TYPES = /^(7|9|13|7b9|7#9|7b5|7#5|7#11|7b13|7alt|7sus4)$/;

/** "E7" in C → "V7/vi". Returns undefined when the chord isn't a secondary dominant. */
export function secondaryLabel(symbol: string, key: string): string | undefined {
  const { tonic, minor } = parseKey(key);
  const [main] = splitSlash(symbol);
  const m = main.match(/^([A-G][#b]*)(.*)$/);
  if (!m || !DOMINANT_TYPES.test(m[2])) return undefined;
  const target = Note.transpose(m[1], '-5P');
  const semis = ((Note.chroma(target)! - Note.chroma(tonic)! + 12) % 12);
  const majorTargets: Record<number, string> = { 2: 'ii', 4: 'iii', 5: 'IV', 7: 'V', 9: 'vi' };
  const minorTargets: Record<number, string> = { 3: 'III', 5: 'iv', 7: 'v', 8: 'VI', 10: 'VII' };
  const label = (minor ? minorTargets : majorTargets)[semis];
  if (!label) return undefined;
  return `V7/${label}`;
}

export function progressionToChords(numerals: string, key: string): ChordEvent[] {
  return parseBars(numerals).map((c) => ({ symbol: romanToChord(c.symbol, key), beats: c.beats }));
}

/**
 * Parses a bar-separated chord string. Chords in the same bar share it evenly.
 * "C G | Am F | F" → C(2) G(2) Am(2) F(2) F(4). A chord can carry an explicit
 * length with a colon: "C:3 G:1".
 */
export function parseBars(text: string, beatsPerBar = 4): ChordEvent[] {
  const out: ChordEvent[] = [];
  for (const bar of text.split('|')) {
    const tokens = bar.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const explicit = tokens.map((t) => {
      const [sym, len] = t.split(':');
      return { sym, len: len ? Number(len) : undefined };
    });
    const fixed = explicit.reduce((a, t) => a + (t.len ?? 0), 0);
    const free = explicit.filter((t) => t.len === undefined).length;
    const share = free ? (beatsPerBar - fixed) / free : 0;
    for (const t of explicit) out.push({ symbol: t.sym, beats: t.len ?? share });
  }
  return out;
}

export function chordsToBars(chords: ChordEvent[], beatsPerBar = 4): string {
  const bars: string[] = [];
  let cur: string[] = [];
  let pos = 0;
  for (const c of chords) {
    const even = c.beats === beatsPerBar / 2 || c.beats === beatsPerBar;
    cur.push(even ? c.symbol : `${c.symbol}:${c.beats}`);
    pos += c.beats;
    if (pos >= beatsPerBar) {
      bars.push(cur.join(' '));
      cur = [];
      pos = 0;
    }
  }
  if (cur.length) bars.push(cur.join(' '));
  return bars.join(' | ');
}

export interface DiatonicChord {
  numeral: string;
  symbol: string;
  fn: 'T' | 'S' | 'D';
}

const MAJOR_TRIADS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const MAJOR_SEVENTHS = ['Imaj7', 'ii7', 'iii7', 'IVmaj7', 'V7', 'vi7', 'viiø7'];
const MINOR_TRIADS = ['i', 'ii°', 'bIII', 'iv', 'v', 'bVI', 'bVII', 'V'];
const MINOR_SEVENTHS = ['i7', 'iiø7', 'bIIImaj7', 'iv7', 'v7', 'bVImaj7', 'bVII7', 'V7'];
const MAJOR_FN: DiatonicChord['fn'][] = ['T', 'S', 'T', 'S', 'D', 'T', 'D'];
const MINOR_FN: DiatonicChord['fn'][] = ['T', 'S', 'T', 'S', 'D', 'S', 'D', 'D'];

export function diatonicChords(key: string, sevenths = false): DiatonicChord[] {
  const { minor } = parseKey(key);
  const list = minor ? (sevenths ? MINOR_SEVENTHS : MINOR_TRIADS) : sevenths ? MAJOR_SEVENTHS : MAJOR_TRIADS;
  const fns = minor ? MINOR_FN : MAJOR_FN;
  return list.map((numeral, i) => ({ numeral, symbol: romanToChord(numeral, key), fn: fns[i] }));
}

/** Commonly borrowed / chromatic chords for the builder palette. */
export function colorChords(key: string): { numeral: string; symbol: string; label: string }[] {
  const { minor } = parseKey(key);
  const list = minor
    ? [
        ['V7', '화성단음계 딸림7화음'],
        ['bII', '나폴리 화음'],
        ['IV7', '도리안 IV'],
        ['V7/iv', 'iv로 가는 부속화음'],
        ['i6', '마이너 6th'],
      ]
    : [
        ['iv', '같은으뜸음조 빌림 iv'],
        ['bVII', '믹솔리디안 bVII'],
        ['bVI', '빌림 bVI'],
        ['V7/vi', 'vi로 가는 부속화음'],
        ['V7/ii', 'ii로 가는 부속화음'],
        ['V7/V', 'V로 가는 부속화음'],
        ['bII7', '트라이톤 대리'],
        ['III7', '왕도 진행의 III7'],
      ];
  return list.map(([numeral, label]) => ({ numeral, symbol: romanToChord(numeral, key), label }));
}

export interface FunctionInfo {
  code: 'T' | 'S' | 'D' | 'SD' | 'B' | '?';
  label: string;
}

/** Harmonic function of a chord in a key (토닉/서브도미넌트/도미넌트/부속/차용). */
export function harmonicFunction(symbol: string, key: string): FunctionInfo {
  const { minor } = parseKey(key);
  if (secondaryLabel(symbol, key)) return { code: 'SD', label: '부속 도미넌트' };
  const roman = chordToRoman(splitSlash(symbol)[0], key);
  const m = roman.match(NUMERAL_RE);
  if (!m) return { code: '?', label: '' };
  const deg = (m[1] || '') + m[2].toUpperCase();
  const lower = m[2] === m[2].toLowerCase();
  const T = minor ? ['I', 'bIII'] : ['I', 'III', 'VI'];
  const S = minor ? ['IV', 'II', 'bVI'] : ['II', 'IV'];
  const D = minor ? ['V', 'bVII', 'VII'] : ['V', 'VII'];
  const diatonicQuality: Record<string, boolean> = minor
    ? { I: true, bIII: false, IV: true, II: true, bVI: false, V: false, bVII: false, VII: true }
    : { I: false, III: true, VI: true, II: true, IV: false, V: false, VII: true };
  const expectedLower = diatonicQuality[deg];
  const borrowed = expectedLower === undefined || (expectedLower !== lower && !(minor && deg === 'V'));
  const base = T.includes(deg) ? { code: 'T' as const, label: '토닉 (안정)' } : S.includes(deg) ? { code: 'S' as const, label: '서브도미넌트 (전개)' } : D.includes(deg) ? { code: 'D' as const, label: '도미넌트 (긴장)' } : null;
  if (borrowed) return { code: 'B', label: base ? `빌린 화음 · ${base.label.split(' ')[0]}` : '조성 밖 화음 (빌린 화음)' };
  return base ?? { code: '?', label: '' };
}
