import { Chord, Interval, Note } from 'tonal';
import { chroma, midiAtOrAbove, nameAtMidi, splitSlash } from './notes';

export interface ChordInfo {
  symbol: string;
  root: string;
  bass: string;
  notes: string[];
  intervals: string[];
  empty: boolean;
}

export function chordInfo(symbol: string): ChordInfo {
  const [main, bass] = splitSlash(symbol);
  const c = Chord.get(main);
  return {
    symbol,
    root: c.tonic ?? '',
    bass: bass ?? c.tonic ?? '',
    notes: c.notes,
    intervals: c.intervals,
    empty: c.empty,
  };
}

/** Role of a note inside a chord, in Korean ("근음", "3음", "♭7음" ...). */
export function noteRole(note: string, symbol: string): string | undefined {
  const info = chordInfo(symbol);
  if (info.empty) return undefined;
  const pc = Note.pitchClass(note);
  const c = chroma(pc);
  const i = info.notes.findIndex((n) => chroma(n) === c);
  if (i < 0) {
    if (chroma(info.bass) === c) return '베이스음';
    return '비화성음';
  }
  const ivl = Interval.get(info.intervals[i]);
  const num = ivl.num ?? 1;
  if (num === 1 || num === 8) return '근음';
  if (num === 3) return ivl.q === 'm' ? '단3음' : '장3음';
  if (num === 7) return ivl.q === 'M' ? '장7음' : ivl.q === 'd' ? '감7음' : '단7음';
  const acc = ivl.q === 'm' || ivl.q === 'd' ? '♭' : ivl.q === 'A' ? '♯' : '';
  return `${acc}${num}음`;
}

const RH_LOW = 53; // F3
const RH_HIGH = 81; // A5
const RH_CENTER = 65;

function priority(ivl: string): number {
  const iv = Interval.get(ivl);
  const n = ((((iv.num ?? 1) - 1) % 7) + 7) % 7 + 1;
  if (n === 3 || ivl === '4P' || ivl === '2M') return 0; // 3rd (or sus tone)
  if (n === 7 || ivl === '6M') return 1;
  if (n === 2 || n === 4 || n === 6) return 2; // 9, 11, 13
  if (n === 5) return 3;
  return 4; // root
}

/** Pitch classes the right hand plays. Big chords are thinned to 4 notes. */
export function rightHandPitchClasses(info: ChordInfo): string[] {
  if (info.notes.length <= 4) return info.notes;
  const ranked = info.notes
    .map((n, i) => ({ n, p: priority(info.intervals[i]), i }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .slice(0, 4)
    .sort((a, b) => a.i - b.i);
  return ranked.map((r) => r.n);
}

/** smooth = pick the inversion closest to the previous chord; root = always root position */
export type VoicingMode = 'smooth' | 'root';

function candidates(pcs: string[], rootOnly = false): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < (rootOnly ? 1 : pcs.length); r++) {
    const order = [...pcs.slice(r), ...pcs.slice(0, r)];
    for (let start = RH_LOW; start < RH_LOW + 12; start++) {
      if (chroma(order[0]) !== start % 12) continue;
      for (const base of [start, start + 12]) {
        const midis = [base];
        for (let k = 1; k < order.length; k++) midis.push(midiAtOrAbove(order[k], midis[k - 1] + 1));
        if (midis[midis.length - 1] <= RH_HIGH) out.push(midis);
      }
    }
  }
  return out;
}

/** Finger travel between two voicings: sorted voice-by-voice when sizes match (optimal in 1-D). */
function distance(a: number[], b: number[]): number {
  if (a.length === b.length) {
    const x = [...a].sort((p, q) => p - q);
    const y = [...b].sort((p, q) => p - q);
    return x.reduce((sum, v, i) => sum + Math.abs(v - y[i]), 0) * 2;
  }
  let d = 0;
  for (const x of a) d += Math.min(...b.map((y) => Math.abs(x - y)));
  for (const y of b) d += Math.min(...a.map((x) => Math.abs(x - y)));
  return d;
}

export interface Voicing {
  symbol: string;
  rh: string[];
  bass: string;
  info: ChordInfo;
}

/** Close-position right hand with smooth voice-leading from `prev`, bass in the left hand. */
export function voiceChord(symbol: string, prev?: string[], mode: VoicingMode = 'smooth'): Voicing {
  const info = chordInfo(symbol);
  if (info.empty) return { symbol, rh: [], bass: 'C3', info };
  const pcs = rightHandPitchClasses(info);
  const prevMidi = mode === 'smooth' ? prev?.map((n) => Note.midi(n) ?? 60) : undefined;
  let best: number[] = [];
  let bestScore = Infinity;
  for (const c of candidates(pcs, mode === 'root')) {
    const avg = c.reduce((a, b) => a + b, 0) / c.length;
    const score = prevMidi?.length ? distance(c, prevMidi) + Math.abs(avg - RH_CENTER) * 0.35 : Math.abs(avg - RH_CENTER);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  const pcByChroma = new Map(pcs.map((p) => [chroma(p), p]));
  const rh = best.map((m) => nameAtMidi(pcByChroma.get(m % 12)!, m));
  const bassMidi = midiAtOrAbove(info.bass, 40);
  return { symbol, rh, bass: nameAtMidi(info.bass, bassMidi), info };
}

/** Voices a whole progression with voice-leading between chords. */
export function voiceProgression(symbols: string[], mode: VoicingMode = 'smooth'): Voicing[] {
  const out: Voicing[] = [];
  let prev: string[] | undefined;
  for (const s of symbols) {
    const v = voiceChord(s, prev, mode);
    out.push(v);
    if (v.rh.length) prev = v.rh;
  }
  return out;
}

/** The chord's fifth (or a perfect fifth over the bass) placed above the bass note. */
export function fifthAbove(v: Voicing): string {
  const i = v.info.intervals.findIndex((x) => x.startsWith('5'));
  const pc = i >= 0 ? v.info.notes[i] : Note.pitchClass(Note.transpose(v.info.root, '5P'));
  const bassMidi = Note.midi(v.bass) ?? 40;
  const m = midiAtOrAbove(pc, bassMidi + 1);
  return nameAtMidi(pc, m);
}

export function octaveAbove(note: string): string {
  return Note.transpose(note, '8P');
}

/** Simple LH shell (root + 7th, or root + 3rd for triads) for jazz comping. */
export function shellVoicing(v: Voicing): string[] {
  const seventh = v.info.intervals.findIndex((x) => x.startsWith('7') || x === '6M');
  const third = v.info.intervals.findIndex((x) => x.startsWith('3'));
  const idx = seventh >= 0 ? seventh : third;
  if (idx < 0) return [v.bass];
  const bassMidi = Note.midi(v.bass) ?? 40;
  const pc = v.info.notes[idx];
  return [v.bass, nameAtMidi(pc, midiAtOrAbove(pc, bassMidi + 1))];
}
