/**
 * Chord estimation from a recorded song (MP3/WAV/M4A), fully in the browser.
 *
 * Classic pipeline from music-information-retrieval research:
 *   1. STFT → per-semitone energy → treble chroma + bass chroma
 *   2. spectral-flux onset envelope → tempo by autocorrelation → beat grid
 *   3. beat-synchronous chroma
 *   4. chord templates (maj/min/7/m7/maj7) scored per beat, smoothed with a
 *      Viterbi pass that charges a penalty for every chord change
 *   5. beats → 4/4 bars (bar phase chosen so changes land on downbeats)
 * It is an estimate: expect mistakes on busy mixes, and edit the result.
 */
import { estimateKeyFromChords } from '../theory/key';
import { keyUsesFlats } from '../theory/keys';
import { pcName } from '../theory/notes';
import { fft } from './fft';

export const ANALYSIS_RATE = 22050;
const N = 8192;
const HOP = 1024;

export interface AnalysisSection {
  name: string;
  /** bar text in the app's format ("C | G | Am F") */
  chords: string;
  start: number;
}

export interface SongAnalysis {
  bpm: number;
  key: string;
  sections: AnalysisSection[];
  /** flat chord list, one entry per change */
  changes: { symbol: string; time: number; beats: number }[];
  duration: number;
}

const TYPES: { suffix: string; tones: number[]; penalty: number }[] = [
  { suffix: '', tones: [0, 4, 7], penalty: 0 },
  { suffix: 'm', tones: [0, 3, 7], penalty: 0 },
  { suffix: '7', tones: [0, 4, 7, 10], penalty: 0.07 },
  { suffix: 'm7', tones: [0, 3, 7, 10], penalty: 0.06 },
  { suffix: 'maj7', tones: [0, 4, 7, 11], penalty: 0.06 },
];

interface Frames {
  chroma: Float32Array[];
  bass: Float32Array[];
  energy: Float32Array;
  flux: Float32Array;
}

async function computeFrames(x: Float32Array, sr: number, onProgress?: (p: number) => void): Promise<Frames> {
  const count = Math.max(1, Math.floor((x.length - N) / HOP) + 1);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const binHz = sr / N;
  const lo = new Int32Array(128);
  const hi = new Int32Array(128);
  for (let m = 24; m < 128; m++) {
    const f = 440 * 2 ** ((m - 69) / 12);
    lo[m] = Math.max(1, Math.floor((f * 2 ** (-0.5 / 12)) / binHz));
    hi[m] = Math.min(N / 2 - 1, Math.max(lo[m], Math.ceil((f * 2 ** (0.5 / 12)) / binHz) - 1));
  }
  const fluxTop = Math.floor(4000 / binHz);
  const chroma: Float32Array[] = [];
  const bass: Float32Array[] = [];
  const energy = new Float32Array(count);
  const flux = new Float32Array(count);
  let prev = new Float32Array(fluxTop);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let f = 0; f < count; f++) {
    const off = f * HOP;
    for (let i = 0; i < N; i++) {
      re[i] = (x[off + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(N / 2);
    let e = 0;
    for (let k = 0; k < N / 2; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      e += mag[k] * mag[k];
    }
    energy[f] = Math.sqrt(e);
    const cur = new Float32Array(fluxTop);
    let fl = 0;
    for (let k = 1; k < fluxTop; k++) {
      cur[k] = Math.log1p(mag[k]);
      const d = cur[k] - prev[k];
      if (d > 0) fl += d;
    }
    flux[f] = fl;
    prev = cur;
    const semi = new Float32Array(128);
    for (let m = 24; m < 108; m++) {
      let p = 0;
      for (let k = lo[m]; k <= hi[m]; k++) if (mag[k] > p) p = mag[k];
      semi[m] = Math.log1p(p * 20);
    }
    // Remove the strongest overtones of lower notes (octave and twelfth) before folding.
    const clean = Float32Array.from(semi);
    // (and the 7th harmonic, which lands on the minor 7th and fakes dominant chords)
    for (let m = 36; m < 108; m++) {
      clean[m] = Math.max(0, semi[m] - 0.5 * semi[m - 12] - 0.25 * (semi[m - 19] ?? 0) - 0.2 * (semi[m - 34] ?? 0));
    }
    const c = new Float32Array(12);
    const b = new Float32Array(12);
    for (let m = 48; m < 96; m++) c[m % 12] += clean[m];
    for (let m = 28; m < 52; m++) b[m % 12] += semi[m];
    chroma.push(c);
    bass.push(b);
    if (f % 200 === 0) {
      onProgress?.(f / count);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { chroma, bass, energy, flux };
}

/** Tempo (frames per beat) and beat frame indices from the onset envelope. */
export function trackBeats(flux: Float32Array, frameRate: number): { period: number; beats: number[]; bpm: number } {
  const n = flux.length;
  const mean = flux.reduce((a, v) => a + v, 0) / Math.max(1, n);
  const env = Float32Array.from(flux, (v) => Math.max(0, v - mean));
  const minLag = Math.round((60 / 180) * frameRate);
  const maxLag = Math.round((60 / 60) * frameRate);
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    s /= n - lag;
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    if (s * prior > bestScore) {
      bestScore = s * prior;
      best = lag;
    }
  }
  // refine fractional period around the best lag
  let period = best;
  let refined = -Infinity;
  for (let p = best - 1; p <= best + 1; p += 0.05) {
    let s = 0;
    for (let k = 0; k * p < n; k++) {
      const i = Math.round(k * p);
      s += env[i] + 0.5 * (env[i + 1] ?? 0) + 0.5 * (env[i - 1] ?? 0);
    }
    if (s > refined) {
      refined = s;
      period = p;
    }
  }
  let phase = 0;
  let phaseScore = -Infinity;
  for (let ph = 0; ph < period; ph += 0.5) {
    let s = 0;
    for (let t = ph; t < n; t += period) s += env[Math.round(t)] ?? 0;
    if (s > phaseScore) {
      phaseScore = s;
      phase = ph;
    }
  }
  const beats: number[] = [];
  for (let t = phase; t < n; t += period) beats.push(Math.round(t));
  return { period, beats, bpm: Math.round((60 * frameRate) / period) };
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

/** Viterbi over chord states (and a no-chord state) per beat. Returns state index per beat; -1 = N.C. */
export function decodeChords(chroma: Float32Array[], bass: Float32Array[], silent: boolean[], changePenalty = 0.9): number[] {
  const states: { root: number; t: number; tpl: number[] }[] = [];
  for (let t = 0; t < TYPES.length; t++) {
    for (let r = 0; r < 12; r++) {
      const tpl = new Array(12).fill(0);
      for (const s of TYPES[t].tones) tpl[(r + s) % 12] = s === 0 ? 1.15 : 1;
      states.push({ root: r, t, tpl });
    }
  }
  const S = states.length + 1; // last = no chord
  const K = 6;
  const T = chroma.length;
  const score = (i: number, s: number) => {
    if (s === S - 1) return silent[i] ? K : K * 0.3;
    if (silent[i]) return 0;
    const st = states[s];
    let v = cosine(chroma[i], st.tpl) - TYPES[st.t].penalty;
    const b = bass[i];
    let bmax = 0;
    let barg = 0;
    for (let k = 0; k < 12; k++) if (b[k] > bmax) (bmax = b[k]), (barg = k);
    if (bmax > 0) {
      if (barg === st.root) v += 0.08;
      else if (!TYPES[st.t].tones.some((x) => (st.root + x) % 12 === barg)) v -= 0.06;
    }
    return K * v;
  };
  let prev = new Float64Array(S);
  for (let s = 0; s < S; s++) prev[s] = score(0, s);
  const back: Int16Array[] = [];
  for (let i = 1; i < T; i++) {
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if (prev[s] > prev[bestPrev]) bestPrev = s;
    const cur = new Float64Array(S);
    const bp = new Int16Array(S);
    for (let s = 0; s < S; s++) {
      const stay = prev[s];
      const move = prev[bestPrev] - changePenalty;
      if (stay >= move) {
        cur[s] = stay + score(i, s);
        bp[s] = s;
      } else {
        cur[s] = move + score(i, s);
        bp[s] = bestPrev;
      }
    }
    back.push(bp);
    prev = cur;
  }
  let last = 0;
  for (let s = 1; s < S; s++) if (prev[s] > prev[last]) last = s;
  const path = new Array(T).fill(0);
  path[T - 1] = last;
  for (let i = T - 1; i > 0; i--) path[i - 1] = back[i - 1][path[i]];
  return path.map((s) => (s === S - 1 ? -1 : s));
}

function stateName(s: number, flats: boolean | undefined) {
  if (s < 0) return 'N.C.';
  const t = Math.floor(s / 12);
  return pcName(s % 12, flats) + TYPES[t].suffix;
}

/** Full analysis of mono samples at `sr`. */
export async function analyzeSamples(x: Float32Array, sr: number, onProgress?: (p: number) => void): Promise<SongAnalysis> {
  const frames = await computeFrames(x, sr, (p) => onProgress?.(p * 0.85));
  const frameRate = sr / HOP;
  const { beats, bpm, period } = trackBeats(frames.flux, frameRate);
  const maxE = Math.max(...frames.energy);
  // beat-synchronous averages
  const bc: Float32Array[] = [];
  const bb: Float32Array[] = [];
  const silent: boolean[] = [];
  for (let i = 0; i < beats.length; i++) {
    const a = beats[i];
    const b = Math.min(frames.chroma.length, beats[i + 1] ?? a + Math.round(period));
    const c = new Float32Array(12);
    const d = new Float32Array(12);
    let e = 0;
    for (let f = a; f < b; f++) {
      for (let k = 0; k < 12; k++) {
        c[k] += frames.chroma[f]?.[k] ?? 0;
        d[k] += frames.bass[f]?.[k] ?? 0;
      }
      e = Math.max(e, frames.energy[f] ?? 0);
    }
    bc.push(c);
    bb.push(d);
    silent.push(e < maxE * 0.02);
  }
  onProgress?.(0.9);
  const path = decodeChords(bc, bb, silent);

  // Spell with the key's accidentals.
  const rough = path.filter((s) => s >= 0).map((s) => stateName(s, undefined));
  const key = estimateKeyFromChords(rough, Infinity, 1)[0]?.key ?? 'C';
  const flats = keyUsesFlats(key);
  const names = path.map((s) => stateName(s, flats));

  // Bar phase: the offset (0-3) that puts the most chord changes on downbeats.
  let phase = 0;
  let phaseScore = -1;
  for (let p = 0; p < 4; p++) {
    let s = 0;
    for (let i = 1; i < names.length; i++) if (names[i] !== names[i - 1] && (i - p) % 4 === 0) s++;
    if (s > phaseScore) {
      phaseScore = s;
      phase = p;
    }
  }
  const beatTime = (i: number) => (beats[i] * HOP) / sr;
  const changes: SongAnalysis['changes'] = [];
  names.forEach((n, i) => {
    if (i < phase) return;
    const last = changes[changes.length - 1];
    if (last && last.symbol === n) last.beats++;
    else changes.push({ symbol: n, time: beatTime(i), beats: 1 });
  });

  // Bars of 4 beats → bar text; sections of 8 bars, identical sections dropped.
  const barTexts: { text: string; time: number }[] = [];
  for (let i = phase; i + 4 <= names.length; i += 4) {
    const bar = names.slice(i, i + 4);
    if (bar.every((n) => n === 'N.C.')) continue;
    const runs: { s: string; n: number }[] = [];
    for (const n of bar) {
      const r = runs[runs.length - 1];
      if (r && r.s === n) r.n++;
      else runs.push({ s: n, n: 1 });
    }
    const clean = runs.filter((r) => r.s !== 'N.C.');
    if (!clean.length) continue;
    // merge single-beat blips into their neighbour
    const merged = clean.length > 2 ? clean.filter((r) => r.n > 1) : clean;
    const use = merged.length ? merged : clean;
    const text =
      use.length === 1
        ? use[0].s
        : use.length === 2 && use[0].n === use[1].n
          ? `${use[0].s} ${use[1].s}`
          : use.map((r) => `${r.s}:${r.n}`).join(' ');
    barTexts.push({ text, time: beatTime(i) });
  }
  const sections: AnalysisSection[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < barTexts.length; i += 8) {
    const chunk = barTexts.slice(i, i + 8);
    const chords = chunk.map((b) => b.text).join(' | ');
    if (seen.has(chords)) continue;
    seen.add(chords);
    const t = chunk[0].time;
    sections.push({ name: `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}~`, chords, start: t });
  }
  onProgress?.(1);
  return { bpm, key, sections, changes, duration: x.length / sr };
}

/** Decodes an audio file and resamples it to mono 22.05 kHz with the Web Audio API. */
export async function decodeAudioFile(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const tmp = new AudioContext();
  try {
    const audio = await tmp.decodeAudioData(buf);
    const length = Math.ceil(audio.duration * ANALYSIS_RATE);
    const off = new OfflineAudioContext(1, length, ANALYSIS_RATE);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return out.getChannelData(0);
  } finally {
    tmp.close();
  }
}
