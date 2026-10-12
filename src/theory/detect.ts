import { pcName } from './notes';

/** Chord templates as semitone offsets from the root. `penalty` slightly disfavors rarer/bigger chords. */
export const TEMPLATES: { suffix: string; tones: number[]; penalty: number }[] = [
  { suffix: '', tones: [0, 4, 7], penalty: 0 },
  { suffix: 'm', tones: [0, 3, 7], penalty: 0 },
  { suffix: '7', tones: [0, 4, 7, 10], penalty: 0.02 },
  { suffix: 'maj7', tones: [0, 4, 7, 11], penalty: 0.02 },
  { suffix: 'm7', tones: [0, 3, 7, 10], penalty: 0.02 },
  { suffix: 'm7b5', tones: [0, 3, 6, 10], penalty: 0.04 },
  { suffix: 'dim', tones: [0, 3, 6], penalty: 0.05 },
  { suffix: 'dim7', tones: [0, 3, 6, 9], penalty: 0.05 },
  { suffix: 'aug', tones: [0, 4, 8], penalty: 0.06 },
  { suffix: 'sus4', tones: [0, 5, 7], penalty: 0.04 },
  { suffix: 'sus2', tones: [0, 2, 7], penalty: 0.05 },
  { suffix: '7sus4', tones: [0, 5, 7, 10], penalty: 0.05 },
  { suffix: '6', tones: [0, 4, 7, 9], penalty: 0.04 },
  { suffix: 'm6', tones: [0, 3, 7, 9], penalty: 0.04 },
  { suffix: 'mMaj7', tones: [0, 3, 7, 11], penalty: 0.06 },
  { suffix: 'add9', tones: [0, 2, 4, 7], penalty: 0.05 },
  { suffix: '9', tones: [0, 2, 4, 7, 10], penalty: 0.05 },
  { suffix: 'maj9', tones: [0, 2, 4, 7, 11], penalty: 0.05 },
  { suffix: 'm9', tones: [0, 2, 3, 7, 10], penalty: 0.05 },
];

export interface ChordGuess {
  symbol: string;
  root: number;
  suffix: string;
  score: number;
  bass?: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Template matching on a 12-bin chroma vector. The bass pitch class (if known)
 * favours chords rooted on it, which disambiguates C6 vs Am7 etc.
 */
export function detectFromChroma(chromaVec: ArrayLike<number>, bassPc?: number, preferFlats?: boolean, top = 3): ChordGuess[] {
  const v = Array.from(chromaVec);
  const max = Math.max(...v);
  if (max <= 0) return [];
  const norm = v.map((x) => x / max);
  const guesses: ChordGuess[] = [];
  for (let root = 0; root < 12; root++) {
    for (const t of TEMPLATES) {
      const tpl = new Array(12).fill(0);
      for (const s of t.tones) tpl[(root + s) % 12] = s === 0 ? 1.1 : 1;
      let score = cosine(norm, tpl) - t.penalty;
      if (bassPc !== undefined) {
        if (bassPc === root) score += 0.08;
        else if (!t.tones.some((s) => (root + s) % 12 === bassPc)) score -= 0.05;
      }
      const bassInChord = bassPc !== undefined && t.tones.some((s) => (root + s) % 12 === bassPc);
      guesses.push({ symbol: '', root, suffix: t.suffix, score, bass: bassInChord ? bassPc : undefined });
    }
  }
  guesses.sort((a, b) => b.score - a.score);
  return guesses.slice(0, top).map((g) => {
    let symbol = pcName(g.root, preferFlats) + g.suffix;
    if (g.bass !== undefined && g.bass !== g.root) symbol += '/' + pcName(g.bass, preferFlats);
    return { ...g, symbol };
  });
}

/** Exact detection from a set of MIDI notes (Web MIDI / on-screen keyboard). */
export function detectFromMidi(midis: number[], preferFlats?: boolean): ChordGuess[] {
  if (midis.length < 2) return [];
  const chromaVec = new Array(12).fill(0);
  for (const m of midis) chromaVec[m % 12] = 1;
  const bass = Math.min(...midis) % 12;
  const pcs = new Set(midis.map((m) => m % 12));
  // Exact template hits first, then nearest by cosine.
  const exact: ChordGuess[] = [];
  for (let root = 0; root < 12; root++) {
    for (const t of TEMPLATES) {
      const set = new Set(t.tones.map((s) => (root + s) % 12));
      if (set.size === pcs.size && [...pcs].every((p) => set.has(p))) {
        let symbol = pcName(root, preferFlats) + t.suffix;
        if (bass !== root) symbol += '/' + pcName(bass, preferFlats);
        exact.push({ symbol, root, suffix: t.suffix, score: 1 + (bass === root ? 0.1 : 0) - t.penalty, bass });
      }
    }
  }
  exact.sort((a, b) => b.score - a.score);
  if (exact.length) return exact;
  return detectFromChroma(chromaVec, bass, preferFlats);
}
