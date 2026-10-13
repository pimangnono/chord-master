import { describe, expect, it } from 'vitest';
import { Chord, Note } from 'tonal';
import { alignChords, syncSections } from './align';
import { ANALYSIS_RATE, beatFeatures } from './songAnalysis';

const SR = ANALYSIS_RATE;
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

function tone(x: Float32Array, midi: number, start: number, dur: number, amp: number) {
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const a = Math.floor(start * SR);
  const len = Math.floor(dur * SR);
  for (let h = 1; h <= 6; h++) {
    const f = f0 * h;
    if (f > SR / 2) break;
    const ah = amp / h ** 1.2;
    for (let i = 0; i < len && a + i < x.length; i++) {
      const env = Math.exp((-3 * i) / SR) * Math.min(1, i / 60);
      x[a + i] += ah * env * Math.sin((2 * Math.PI * f * i) / SR);
    }
  }
}

/** Drums for `introBeats`, then each chord for its number of beats (piano on every beat, bass, melody, drums). */
function band(chords: [string, number][], bpm: number, introBeats: number) {
  const beat = 60 / bpm;
  const totalBeats = introBeats + chords.reduce((a, [, b]) => a + b, 0) + 4;
  const x = new Float32Array(Math.ceil((totalBeats * beat + 1) * SR));
  const drums = (t: number) => {
    const k = Math.floor(t * SR);
    for (let i = 0; i < 2500; i++) x[k + i] += 0.5 * Math.exp(-i / 500) * Math.sin((2 * Math.PI * 55 * i) / SR);
    for (const off of [0, beat / 2]) {
      const h = Math.floor((t + off) * SR);
      for (let i = 0; i < 600; i++) x[h + i] += 0.05 * Math.exp(-i / 120) * rand();
    }
  };
  let t = 0.2;
  for (let b = 0; b < introBeats; b++, t += beat) drums(t);
  const starts: number[] = [];
  chords.forEach(([sym, beats], ci) => {
    starts.push(t);
    const [main, slash] = sym.split('/');
    const c = Chord.get(main);
    const notes = c.notes.map((n) => Note.midi(n + '4')!).map((m) => (m > 71 ? m - 12 : m));
    tone(x, Note.midi((slash ?? c.tonic) + '2')!, t, beat * beats, 0.35);
    for (let b = 0; b < beats; b++) {
      for (const m of notes) tone(x, m, t + b * beat, beat * 0.9, 0.12);
      tone(x, notes[(b + ci) % notes.length] + 12, t + b * beat, beat * 0.8, 0.08);
      drums(t + b * beat);
    }
    t += beat * beats;
  });
  return { x, starts };
}

describe('aligning a pasted chord sheet to a recording', () => {
  it('finds each chord length, the intro and the tempo', async () => {
    // a verse with uneven harmonic rhythm: 1 bar, ½ bars, 2 bars
    const truth: [string, number][] = [
      ['C', 4], ['Em', 2], ['Am7', 2], ['Dm7', 2], ['G', 2], ['Em7', 2], ['A7', 2],
      ['Dm7', 4], ['G', 4], ['F', 4], ['Fm', 4], ['C', 2], ['C/B', 2], ['Am7', 2], ['Em', 2], ['F', 4], ['G', 8],
    ];
    const { x, starts } = band(truth, 92, 8);
    const f = await beatFeatures(x, SR);
    const a = alignChords(truth.map(([s]) => s), f, { preferBpm: 92 })!;
    expect(a).not.toBeNull();
    expect(Math.abs(a.bpm - 92)).toBeLessThan(4);
    expect(a.chords.map((c) => c.symbol)).toEqual(truth.map(([s]) => s));
    const beat = 60 / 92;
    // every chord starts within half a beat of the truth
    const off = a.chords.map((c, i) => Math.abs(c.time - starts[i]) / beat);
    expect(Math.max(...off)).toBeLessThan(0.6);
    expect(a.chords.map((c) => c.beats)).toEqual(truth.map(([, b]) => b));
    expect(Math.abs(a.start - starts[0])).toBeLessThan(beat * 0.6);
    expect(a.fit).toBeGreaterThan(0.6);
  }, 60000);

  it('skips an intro the sheet leaves out', async () => {
    const sheet: [string, number][] = [['C', 4], ['G', 4], ['Am', 4], ['F', 4], ['C', 4], ['G', 4], ['F', 8]];
    const { x, starts } = band([['Dm7', 4], ['Bb', 4], ...sheet], 100, 0);
    const f = await beatFeatures(x, SR);
    const a = alignChords(sheet.map(([s]) => s), f, { preferBpm: 100 })!;
    const beat = 0.6;
    expect(Math.abs(a.start - starts[2]) / beat).toBeLessThan(0.6);
    expect(a.chords.map((c) => c.beats)).toEqual(sheet.map(([, b]) => b));
  }, 60000);

  it('merges repeated chords and copes with a tracker locked to double time', async () => {
    const truth: [string, number][] = [['Am', 8], ['F', 4], ['C', 4], ['G', 8]];
    const { x } = band(truth, 70, 4);
    const f = await beatFeatures(x, SR);
    const a = alignChords(['Am', 'Am', 'F', 'C', 'G'], f, { preferBpm: 70 })!;
    expect(a.chords.map((c) => c.symbol)).toEqual(['Am', 'F', 'C', 'G']);
    expect(Math.abs(a.bpm - 70)).toBeLessThan(4);
    expect(a.chords.map((c) => c.beats)).toEqual([8, 4, 4, 8]);
  }, 60000);

  it('re-times sections and moves a sheet written in another key', async () => {
    // recording in D; the pasted sheet is the easy-key version in C, one chord per bar
    const rec: [string, number][] = [['D', 4], ['F#m', 2], ['Bm7', 2], ['Em7', 4], ['A', 4], ['G', 4], ['A', 4], ['D', 8]];
    const { x } = band(rec, 96, 4);
    const f = await beatFeatures(x, SR);
    const r = syncSections(
      [
        { name: '벌스', chords: 'C | Em | Am7 | Dm7' },
        { name: '후렴', chords: 'G | F | G | C | C' },
      ],
      f,
      96,
    )!;
    expect(r.shift).toBe(2);
    expect(r.sections).toEqual([
      { name: '벌스', chords: 'D | F#m Bm7 | Em7' },
      { name: '후렴', chords: 'A | G | A | D:8' },
    ]);
  }, 60000);

  it('refuses symbols it cannot read', async () => {
    const { x } = band([['C', 4]], 100, 0);
    const f = await beatFeatures(x, SR);
    expect(alignChords(['C', 'Xyz'], f)).toBeNull();
  }, 60000);
});
