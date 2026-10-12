import { Note } from 'tonal';
import { chroma, splitSlash } from './notes';
import { chordInfo, noteRole, voiceProgression, Voicing } from './voicing';

export interface InversionInfo {
  /** 0 = 기본형, 1 = 1전위, 2 = 2전위, 3 = 3전위, -1 = other */
  number: number;
  name: string;
  detail: string;
}

/** Which inversion the right hand plays (judged by its lowest note). */
export function inversionOf(v: Voicing): InversionInfo {
  if (!v.rh.length) return { number: -1, name: '—', detail: '' };
  const low = v.rh[0];
  const role = noteRole(low, v.symbol) ?? '';
  const rootless = !v.rh.some((n) => chroma(n) === chroma(v.info.root));
  const tail = rootless ? ' · 근음은 왼손이 담당' : '';
  if (role === '근음') return { number: 0, name: '기본형', detail: '근음이 맨 아래' + tail };
  if (role.endsWith('3음') || role === '4음' || role === '2음') return { number: 1, name: '1전위', detail: `${role}이 맨 아래` + tail };
  if (role.endsWith('5음')) return { number: 2, name: '2전위', detail: `${role}이 맨 아래` + tail };
  if (role.endsWith('7음') || role === '6음') return { number: 3, name: '3전위', detail: `${role}이 맨 아래` + tail };
  return { number: -1, name: '텐션 보이싱', detail: `${role}이 맨 아래` + tail };
}

export interface Motion {
  /** total semitones the right-hand fingers travel */
  moved: number;
  /** notes held over from the previous chord */
  common: string[];
}

export function motionBetween(a: string[], b: string[]): Motion {
  const am = a.map((n) => Note.midi(n)!).sort((x, y) => x - y);
  const bm = b.map((n) => Note.midi(n)!).sort((x, y) => x - y);
  const common = b.filter((n) => am.includes(Note.midi(n)!));
  let moved = 0;
  if (am.length === bm.length) {
    for (let i = 0; i < am.length; i++) moved += Math.abs(am[i] - bm[i]);
  } else {
    for (const x of bm) moved += Math.min(...am.map((y) => Math.abs(x - y)));
  }
  return { moved, common };
}

export interface InversionRow {
  symbol: string;
  voicing: Voicing;
  inversion: InversionInfo;
  motion?: Motion;
}

export interface InversionAnalysis {
  smooth: InversionRow[];
  root: InversionRow[];
  smoothTotal: number;
  rootTotal: number;
}

function rows(symbols: string[], mode: 'smooth' | 'root'): InversionRow[] {
  const vs = voiceProgression(symbols, mode);
  return vs.map((v, i) => ({
    symbol: v.symbol,
    voicing: v,
    inversion: inversionOf(v),
    motion: i > 0 ? motionBetween(vs[i - 1].rh, v.rh) : undefined,
  }));
}

/** Compares smooth voice-leading (inversions) against playing every chord in root position. */
export function analyzeInversions(symbols: string[]): InversionAnalysis {
  const smooth = rows(symbols, 'smooth');
  const root = rows(symbols, 'root');
  const total = (r: InversionRow[]) => r.reduce((a, x) => a + (x.motion?.moved ?? 0), 0);
  return { smooth, root, smoothTotal: total(smooth), rootTotal: total(root) };
}

export interface BassSuggestion {
  index: number;
  from: string;
  symbol: string;
  bass: string;
  /** semitones the bass now moves (signed) */
  step: number;
  leap: number;
}

function signedStep(fromPc: number, toPc: number): number {
  let d = (toPc - fromPc + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

/**
 * Suggests slash chords (bass on the 3rd or 5th) where the bass would
 * otherwise leap, so the bass line moves by step — e.g. C → G/B → Am.
 */
export function bassSuggestions(symbols: string[]): BassSuggestion[] {
  const out: BassSuggestion[] = [];
  for (let i = 1; i < symbols.length; i++) {
    const prev = chordInfo(symbols[i - 1]);
    const [main, slash] = splitSlash(symbols[i]);
    const cur = chordInfo(main);
    if (slash || cur.empty || prev.empty) continue;
    const prevBass = chroma(prev.bass);
    const leap = Math.abs(signedStep(prevBass, chroma(cur.root)));
    if (leap < 3) continue;
    let best: { pc: string; step: number } | null = null;
    for (const tone of cur.notes.slice(1, 3)) {
      const step = signedStep(prevBass, chroma(tone));
      if (step !== 0 && Math.abs(step) <= 2 && (!best || Math.abs(step) < Math.abs(best.step))) best = { pc: tone, step };
    }
    if (best) out.push({ index: i, from: symbols[i], symbol: `${main}/${best.pc}`, bass: best.pc, step: best.step, leap });
  }
  return out;
}
