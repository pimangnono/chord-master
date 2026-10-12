import { Chord, Note } from 'tonal';
import { MAJOR_KEYS, MINOR_KEYS } from './keys';

// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export interface KeyGuess {
  key: string;
  score: number;
}

/** Estimates the key from an accumulated 12-bin pitch-class histogram. */
export function estimateKey(hist: ArrayLike<number>): KeyGuess[] {
  const h = Array.from(hist);
  if (h.every((x) => x === 0)) return [];
  const out: KeyGuess[] = [];
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => h.map((_, i) => p[(i - t + 12) % 12]);
    out.push({ key: MAJOR_KEYS[t], score: pearson(h, rot(MAJOR)) });
    out.push({ key: MINOR_KEYS[t], score: pearson(h, rot(MINOR)) });
  }
  return out.sort((a, b) => b.score - a.score);
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11]; // natural minor + leading tone (harmonic V)

/**
 * Estimates the key from a sequence of chords (most recent last). Each key
 * scores by how many recent chords fit its scale, with bonuses for its tonic
 * chord and for V(7) → I resolutions, and a small tiebreak from the
 * Krumhansl profile of all chord tones.
 */
export function estimateKeyFromChords(symbols: string[], window = 8, decay = 0.85): KeyGuess[] {
  const recent = symbols.slice(-window);
  if (!recent.length) return [];
  const infos = recent.map((s) => {
    const [main, bass] = s.split(/\/(?=[A-G][#b]*$)/);
    const c = Chord.get(main);
    const pcs = c.notes.map((n) => Note.chroma(n)!);
    if (bass) pcs.push(Note.chroma(bass)!);
    return { root: c.tonic ? Note.chroma(c.tonic)! : -1, pcs, minor: c.quality === 'Minor', dom: c.intervals.includes('3M') && c.intervals.includes('7m') };
  });
  const hist = new Array(12).fill(0);
  infos.forEach((c) => c.pcs.forEach((p) => (hist[p] += 1)));
  const profile = new Map(estimateKey(hist).map((g) => [g.key, g.score]));
  const out: KeyGuess[] = [];
  for (let t = 0; t < 12; t++) {
    for (const minor of [false, true]) {
      const scale = new Set((minor ? MINOR_SCALE : MAJOR_SCALE).map((s) => (s + t) % 12));
      let score = 0;
      infos.forEach((c, i) => {
        if (c.root < 0) return;
        const w = decay ** (infos.length - 1 - i);
        if (c.pcs.every((p) => scale.has(p))) score += w;
        if (c.root === t && c.minor === minor) score += 0.35 * w;
        const prev = infos[i - 1];
        if (prev?.dom && prev.root === (t + 7) % 12 && c.root === t) score += 0.6 * w;
      });
      const key = minor ? MINOR_KEYS[t] : MAJOR_KEYS[t];
      out.push({ key, score: score + 0.1 * (profile.get(key) ?? 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
