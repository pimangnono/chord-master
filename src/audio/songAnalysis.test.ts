import { describe, expect, it } from 'vitest';
import { Chord, Note } from 'tonal';
import { analyzeSamples, ANALYSIS_RATE, trackBeats } from './songAnalysis';

const SR = ANALYSIS_RATE;
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

function tone(x: Float32Array, midi: number, start: number, dur: number, amp: number) {
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const a = Math.floor(start * SR);
  const len = Math.floor(dur * SR);
  for (let h = 1; h <= 8; h++) {
    const f = f0 * h;
    if (f > SR / 2) break;
    const ah = amp / h ** 1.2;
    for (let i = 0; i < len && a + i < x.length; i++) {
      const env = Math.exp((-3 * i) / SR) * Math.min(1, i / 60);
      x[a + i] += ah * env * Math.sin((2 * Math.PI * f * i) / SR);
    }
  }
}

/** A small band: piano chords on each beat, bass roots, kick/hat noise, and a melody. */
function song(progression: string[], bpm: number, repeats: number) {
  const beat = 60 / bpm;
  const total = progression.length * repeats * 4 * beat + 1;
  const x = new Float32Array(Math.ceil(total * SR));
  let t = 0.25;
  for (let r = 0; r < repeats; r++) {
    for (const sym of progression) {
      const c = Chord.get(sym);
      const notes = c.notes.map((n) => Note.midi(n + '4')!).map((m) => (m > 71 ? m - 12 : m));
      const root = Note.midi(c.tonic + '2')!;
      tone(x, root, t, beat * 4, 0.35);
      for (let b = 0; b < 4; b++) {
        for (const m of notes) tone(x, m, t + b * beat, beat * 0.9, 0.12);
        // melody: a chord tone an octave up, sometimes a passing scale step
        const mel = notes[(b + r) % notes.length] + 12 + (b === 3 ? 2 : 0);
        tone(x, mel, t + b * beat, beat * 0.8, 0.08);
        // kick
        const k = Math.floor((t + b * beat) * SR);
        for (let i = 0; i < 2500; i++) x[k + i] += 0.5 * Math.exp(-i / 500) * Math.sin((2 * Math.PI * 55 * i) / SR);
        // hats on 8ths
        for (const off of [0, beat / 2]) {
          const h = Math.floor((t + b * beat + off) * SR);
          for (let i = 0; i < 600; i++) x[h + i] += 0.05 * Math.exp(-i / 120) * rand();
        }
      }
      t += beat * 4;
    }
  }
  return x;
}

describe('beat tracking', () => {
  it('follows a tempo that drifts (no click track)', () => {
    const fps = ANALYSIS_RATE / 1024;
    const flux = new Float32Array(Math.round(fps * 120));
    const truth: number[] = [];
    // 76 BPM swaying ±5% over every 48 beats, with a little noise
    for (let k = 0, t = 0.5; t < 119; k++) {
      truth.push(Math.round(t * fps));
      t += (60 / 76) * (1 + 0.05 * Math.sin((2 * Math.PI * k) / 48));
    }
    for (const f of truth) flux[f] += 1;
    for (let i = 0; i < flux.length; i++) flux[i] += 0.15 * ((i * 7919) % 13) / 13;
    const { beats, bpm } = trackBeats(flux, fps);
    expect(Math.abs(bpm - 76)).toBeLessThan(3);
    // every true beat has a tracked beat within one frame (~46 ms)
    const missed = truth.filter((f) => !beats.some((b) => Math.abs(b - f) <= 1));
    expect(missed.length).toBe(0);
  });
});

describe('song chord analysis (synthetic band)', () => {
  it('recovers a pop progression, key and tempo', async () => {
    const x = song(['C', 'G', 'Am', 'F'], 100, 4);
    const r = await analyzeSamples(x, SR);
    expect([100, 200, 50]).toContain(Math.round(r.bpm / 5) * 5);
    expect(r.key).toMatch(/^(C|Am)$/);
    const seq = r.changes.filter((c) => c.symbol !== 'N.C.' && c.beats >= 2).map((c) => c.symbol);
    const joined = seq.join(' ');
    expect(joined, joined).toContain('C G Am F C G Am F');
    expect(r.sections[0].chords.replace(/\s+/g, ' '), r.sections[0].chords).toMatch(/C \| G \| Am \| F/);
  }, 30000);

  it('handles minor keys and sevenths', async () => {
    const x = song(['Am7', 'Dm7', 'G7', 'Cmaj7'], 92, 3);
    const r = await analyzeSamples(x, SR);
    const seq = r.changes.filter((c) => c.beats >= 2).map((c) => c.symbol.replace(/7$|maj7$/, ''));
    expect(seq.join(' '), r.changes.map((c) => c.symbol).join(' ')).toContain('Am Dm G C');
  }, 30000);
});
