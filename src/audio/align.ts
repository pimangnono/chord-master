/**
 * Lines up a known chord sequence (from a pasted chord sheet) with a
 * recording. A chord sheet gives the order of the chords but not how long
 * each lasts; the recording gives the timing. Instead of guessing chords
 * from scratch, we only have to decide where each known chord starts —
 * a much easier and more reliable problem.
 *
 * Segment (semi-Markov) dynamic programming over half-bar units:
 *   intro (no chord yet) → chord 1 → chord 2 → … → chord N → outro
 * Each chord covers a whole number of half bars; its score is how well
 * the recording's beat chroma matches the chord's notes, plus a mild
 * preference for common lengths (½, 1, 2, 4 bars).
 */
import { Chord, Interval, Note } from 'tonal';
import { transposeChord } from '../theory/keys';
import { splitSlash } from '../theory/notes';
import { ChordEvent, chordsToBars, parseBars } from '../theory/roman';
import type { BeatFeatures } from './songAnalysis';

export interface AlignedChord {
  symbol: string;
  /** seconds where the chord starts in the recording */
  time: number;
  /** length in beats of the song's tempo */
  beats: number;
}

export interface Alignment {
  chords: AlignedChord[];
  bpm: number;
  /** seconds before the first chord (intro the sheet does not cover) */
  start: number;
  /** seconds after which the sheet's chords are over */
  end: number;
  /** average chord/recording match: 0 = like noise, 1 = only the chord's notes */
  fit: number;
}

const K = 6;
/** emission of the intro/outro states: below a good chord match, above noise or a wrong chord */
const FREE = 0.3;
/** longest chord considered, in half-bar units (8 bars) */
const MAX_UNITS = 16;

interface Template {
  tpl: number[];
  bass: number;
  tones: Set<number>;
  /** cosine of a flat (toneless) chroma with this template — drums and noise score this */
  flat: number;
}

function template(symbol: string): Template | null {
  const [main, slash] = splitSlash(symbol);
  const c = Chord.get(main);
  if (c.empty || !c.tonic) return null;
  const root = Note.chroma(c.tonic)!;
  const tpl = new Array(12).fill(0);
  const tones = new Set<number>();
  for (const n of c.notes) {
    const pc = Note.chroma(n)!;
    tones.add(pc);
    tpl[pc] = pc === root ? 1.15 : 1;
  }
  const bass = slash ? (Note.chroma(slash) ?? root) : root;
  const sum = tpl.reduce((a, v) => a + v, 0);
  const sq = tpl.reduce((a, v) => a + v * v, 0);
  return { tpl, bass, tones, flat: sum / Math.sqrt(12 * sq) };
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/** How much better than toneless noise a chroma matches the template: 0 = noise, 1 = only chord tones. */
function match(c: ArrayLike<number>, tp: Template) {
  return Math.max(-1, (cosine(c, tp.tpl) - tp.flat) / (1 - tp.flat));
}

/** Preference for usual chord lengths (in half-bar units). */
function lengthPrior(d: number): number {
  if (d === 2 || d === 4) return 0;
  if (d === 1 || d === 8) return -0.15 * K;
  if (d === 6 || d === 16) return -0.35 * K;
  return -0.5 * K;
}

/** Beat grid at the song's tempo: merges or splits tracked beats when the tracker locked onto double/half time. */
function musicalBeats(f: BeatFeatures, preferBpm?: number) {
  let factor = 1;
  if (preferBpm && preferBpm > 0) {
    const r = f.bpm / preferBpm;
    if (r > 1.75 && r < 2.3) factor = 2;
    else if (r > 0.43 && r < 0.57) factor = 0.5;
  }
  const times: number[] = [];
  const chroma: Float32Array[] = [];
  const bass: Float32Array[] = [];
  const silent: boolean[] = [];
  if (factor === 2) {
    for (let i = 0; i + 1 < f.beatTimes.length; i += 2) {
      times.push(f.beatTimes[i]);
      chroma.push(f.chroma[i].map((v, k) => v + f.chroma[i + 1][k]));
      bass.push(f.bass[i].map((v, k) => v + f.bass[i + 1][k]));
      silent.push(f.silent[i] && f.silent[i + 1]);
    }
  } else if (factor === 0.5) {
    for (let i = 0; i < f.beatTimes.length; i++) {
      const next = f.beatTimes[i + 1] ?? f.beatTimes[i] + 60 / f.bpm;
      for (const t of [f.beatTimes[i], (f.beatTimes[i] + next) / 2]) {
        times.push(t);
        chroma.push(f.chroma[i]);
        bass.push(f.bass[i]);
        silent.push(f.silent[i]);
      }
    }
  } else {
    times.push(...f.beatTimes);
    chroma.push(...f.chroma);
    bass.push(...f.bass);
    silent.push(...f.silent);
  }
  return { times, chroma, bass, silent, bpm: Math.round(f.bpm / factor) };
}

/**
 * Finds where each chord of `symbols` (in order; consecutive repeats are
 * merged) sits in the recording.
 */
export function alignChords(symbols: string[], features: BeatFeatures, opts: { preferBpm?: number; mergeRepeats?: boolean } = {}): Alignment | null {
  const seq: string[] = [];
  for (const s of symbols) if (opts.mergeRepeats === false || s !== seq[seq.length - 1]) seq.push(s);
  const tpls = seq.map(template);
  if (!seq.length || tpls.some((t) => !t)) return null;
  const beats = musicalBeats(features, opts.preferBpm);
  const N = seq.length;

  let best: { score: number; phase: number; segs: [number, number][]; T: number } | null = null;
  for (const phase of [0, 1]) {
    // half-bar units: two beats each, starting at `phase`
    const units: { c: Float32Array; b: Float32Array; silent: boolean }[] = [];
    for (let i = phase; i + 1 < beats.times.length; i += 2) {
      units.push({
        c: beats.chroma[i].map((v, k) => v + beats.chroma[i + 1][k]),
        b: beats.bass[i].map((v, k) => v + beats.bass[i + 1][k]),
        silent: beats.silent[i] && beats.silent[i + 1],
      });
    }
    const T = units.length;
    if (T < N) continue;

    // cumulative emission per chord so any segment sum is O(1)
    const cum = tpls.map((tp) => {
      const out = new Float64Array(T + 1);
      for (let t = 0; t < T; t++) {
        const u = units[t];
        let v = 0;
        if (!u.silent) {
          v = match(u.c, tp!);
          let bmax = 0;
          let barg = -1;
          for (let k = 0; k < 12; k++) if (u.b[k] > bmax) (bmax = u.b[k]), (barg = k);
          if (barg === tp!.bass) v += 0.08;
          else if (barg >= 0 && !tp!.tones.has(barg)) v -= 0.05;
        }
        out[t + 1] = out[t] + K * v;
      }
      return out;
    });

    // dp[j][t]: best score with chords 0..j-1 placed and chord j-1 ending at unit t
    const NEG = -Infinity;
    const dp: Float64Array[] = Array.from({ length: N + 1 }, () => new Float64Array(T + 1).fill(NEG));
    const from: Int32Array[] = Array.from({ length: N + 1 }, () => new Int32Array(T + 1).fill(-1));
    const maxIntro = Math.floor(T / 2);
    for (let t = 0; t <= maxIntro; t++) dp[0][t] = K * FREE * t;
    for (let j = 1; j <= N; j++) {
      const c = cum[j - 1];
      for (let t = j; t <= T; t++) {
        let bv = NEG;
        let bs = -1;
        for (let d = 1; d <= MAX_UNITS && d <= t; d++) {
          const prev = dp[j - 1][t - d];
          if (prev === NEG) continue;
          const v = prev + c[t] - c[t - d] + lengthPrior(d);
          if (v > bv) (bv = v), (bs = t - d);
        }
        dp[j][t] = bv;
        from[j][t] = bs;
      }
    }
    let endT = -1;
    let endV = NEG;
    for (let t = N; t <= T; t++) {
      if (dp[N][t] === NEG) continue;
      const v = dp[N][t] + K * FREE * (T - t);
      if (v > endV) (endV = v), (endT = t);
    }
    if (endT < 0) continue;
    const segs: [number, number][] = [];
    for (let j = N, t = endT; j >= 1; j--) {
      const s = from[j][t];
      segs.unshift([s, t]);
      t = s;
    }
    const score = endV / T;
    if (!best || score > best.score) best = { score, phase, segs, T };
  }
  if (!best) return null;

  const { phase, segs } = best;
  const unitTime = (u: number) => beats.times[Math.min(beats.times.length - 1, phase + 2 * u)];
  const chords: AlignedChord[] = segs.map(([s, t], j) => ({ symbol: seq[j], time: unitTime(s), beats: (t - s) * 2 }));
  // average match of the chosen chords, without the length prior
  let fit = 0;
  let units = 0;
  segs.forEach(([s, t], j) => {
    for (let u = s; u < t; u++) {
      const i = phase + 2 * u;
      fit += match(
        beats.chroma[i].map((x, k) => x + (beats.chroma[i + 1]?.[k] ?? 0)),
        tpls[j]!,
      );
      units++;
    }
  });
  const last = segs[segs.length - 1];
  return {
    chords,
    bpm: beats.bpm,
    start: chords[0].time,
    end: unitTime(last[1]),
    fit: units ? fit / units : 0,
  };
}

export interface SectionSync {
  /** sections rewritten with the recording's chord lengths */
  sections: { name: string; chords: string }[];
  alignment: Alignment;
  /** semitones the sheet was moved to match the recording (0 = it already matched) */
  shift: number;
}

/**
 * Re-times a song's sections from a recording. Repeated chords inside a
 * section are merged (they only mean "keep playing it"), and if the sheet is
 * written in another key than the recording (capo/easy-key sheets) the
 * chords are moved to the recording's key.
 */
export function syncSections(sections: { name: string; chords: string }[], features: BeatFeatures, preferBpm?: number): SectionSync | null {
  const owner: number[] = [];
  const seq: string[] = [];
  sections.forEach((sec, si) => {
    let prev = '';
    for (const { symbol } of parseBars(sec.chords)) {
      if (symbol === prev) continue;
      seq.push(symbol);
      owner.push(si);
      prev = symbol;
    }
  });
  if (!seq.length) return null;
  let best: { a: Alignment; shift: number; symbols: string[] } | null = null;
  for (let shift = -5; shift <= 6; shift++) {
    const ivl = Interval.fromSemitones(shift) || '1P';
    const symbols = shift ? seq.map((c) => transposeChord(c, ivl)) : seq;
    const a = alignChords(symbols, features, { preferBpm, mergeRepeats: false });
    if (!a) continue;
    // moving the music needs clear evidence; the sheet as written gets the benefit of the doubt
    const bonus = shift === 0 ? 0.08 : 0;
    if (!best || a.fit + bonus > best.a.fit + (best.shift === 0 ? 0.08 : 0)) best = { a, shift, symbols };
  }
  if (!best) return null;
  const events: ChordEvent[][] = sections.map(() => []);
  best.a.chords.forEach((c, i) => events[owner[i]].push({ symbol: c.symbol, beats: c.beats }));
  return {
    sections: sections.map((sec, i) => ({ name: sec.name, chords: events[i].length ? chordsToBars(events[i]) : sec.chords })),
    alignment: best.a,
    shift: best.shift,
  };
}
