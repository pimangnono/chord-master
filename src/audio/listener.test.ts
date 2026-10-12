import { describe, expect, it } from 'vitest';
import { detectFromChroma } from '../theory/detect';
import { fft } from './fft';
import { analyzeSpectrum } from './listener';

const SR = 48000;
const N = 16384;

let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

/** Piano-like tone: decaying, slightly inharmonic partials with a weak fundamental in the bass. */
function synth(midis: number[], noise = 0.002) {
  const x = new Float64Array(N);
  for (const m of midis) {
    const f0 = 440 * 2 ** ((m - 69) / 12);
    const B = 0.0003;
    for (let n = 1; n <= 14; n++) {
      const f = n * f0 * Math.sqrt(1 + B * n * n);
      if (f > SR / 2) break;
      let a = 0.12 / n ** 1.15;
      if (n === 1 && f0 < 140) a *= 0.45;
      if (n === 2 && f0 < 140) a *= 1.2;
      const ph = rand() * 6.28;
      for (let i = 0; i < N; i++) x[i] += a * Math.sin((2 * Math.PI * f * i) / SR + ph);
    }
  }
  let sum = 0;
  for (let i = 0; i < N; i++) {
    x[i] += noise * rand() * 2;
    sum += x[i] * x[i];
  }
  const rms = Math.sqrt(sum / N);
  // Blackman window + FFT, scaled like AnalyserNode (dB of |X|/N)
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N);
    re[i] = x[i] * w;
  }
  fft(re, im);
  const db = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / N + 1e-12);
  return { db, rms };
}

const cases: [string, number[]][] = [
  ['C', [48, 64, 67, 72]],
  ['Am7', [45, 55, 60, 64]],
  ['G7', [43, 53, 59, 62]],
  ['Fmaj7', [41, 57, 60, 64]],
  ['Dm', [50, 65, 69]],
  ['A#', [46, 62, 65, 70]],
  ['E/G#', [44, 64, 68, 71]],
  ['Cm7', [48, 58, 63, 67]],
];

describe('microphone chord recognition (synthetic piano)', () => {
  for (const [name, midis] of cases) {
    it(`recognises ${name}`, () => {
      const { db, rms } = synth(midis);
      const frame = analyzeSpectrum(db, SR / N, rms, 0.5);
      const guess = detectFromChroma(frame.chroma, frame.bass !== undefined ? frame.bass % 12 : undefined, false)[0];
      expect(guess?.symbol, `notes: ${frame.notes.map((n) => n.midi).join(',')}`).toBe(name);
    });
  }

  for (const [name, midis] of [
    ['C/E', [52, 60, 67, 72]],
    ['D7', [50, 60, 66, 69]],
    ['Bm', [47, 62, 66, 71]],
    ['F#m7', [42, 57, 61, 64]],
  ] as [string, number[]][]) {
    it(`recognises ${name} with room noise`, () => {
      const { db, rms } = synth(midis, 0.01);
      const frame = analyzeSpectrum(db, SR / N, rms, 0.5);
      const guess = detectFromChroma(frame.chroma, frame.bass !== undefined ? frame.bass % 12 : undefined, false)[0];
      expect(guess?.symbol, `notes: ${frame.notes.map((n) => n.midi).join(',')}`).toBe(name);
    });
  }

  it('stays silent on quiet noise', () => {
    const x = synth([], 0.001);
    expect(analyzeSpectrum(x.db, SR / N, x.rms, 0.5).notes).toHaveLength(0);
  });
});
