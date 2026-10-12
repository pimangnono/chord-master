import { describe, expect, it } from 'vitest';
import { seededRng } from '../game/stages';
import { nextDrillChord, pickInversion, tonicChord } from './drill';
import { inversionChoices, playedInversion } from './inversion';
import { harmonicFunction } from './roman';

function walk(key: string, style: 'pop' | 'jazz', range: 'diatonic' | 'color', n: number, seed = 3) {
  const rng = seededRng(seed);
  let cur = tonicChord(key, style);
  const hist = [cur.symbol];
  for (let i = 1; i < n; i++) {
    cur = nextDrillChord(cur, hist, i, { key, style, range }, rng);
    hist.push(cur.symbol);
  }
  return hist;
}

describe('chord drill', () => {
  it('walks only through diatonic chords when asked', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = walk('C', 'pop', 'diatonic', 64, seed);
      for (const s of h) expect(['T', 'S', 'D'], s).toContain(harmonicFunction(s, 'C').code);
      for (let i = 1; i < h.length; i++) expect(h[i]).not.toBe(h[i - 1]);
    }
  });

  it('keeps pop drills to triads and dominant sevenths', () => {
    for (const seed of [1, 2, 3, 4]) for (const s of walk('C', 'pop', 'color', 40, seed)) expect(s).toMatch(/^[A-G][#b]?(m|dim|7)?$/);
  });

  it('names sus chord tones correctly', () => {
    expect(inversionChoices('G7sus4').map((c) => c.role)).toEqual(['근음', '4음(sus)', '5음', '7음']);
  });

  it('forms phrases that cadence home', () => {
    let cadences = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const h = walk('G', 'pop', 'diatonic', 32, seed);
      for (let i = 7; i < h.length; i += 8) if (/^G$/.test(h[i]) && /^D/.test(h[i - 1])) cadences++;
    }
    expect(cadences).toBeGreaterThan(10); // most of the 32 phrase endings are V → I
  });

  it('uses seventh chords for jazz', () => {
    const h = walk('F', 'jazz', 'color', 24);
    expect(h.filter((s) => /7|9|13/.test(s)).length).toBeGreaterThan(18);
  });

  it('knows inversions', () => {
    expect(inversionChoices('C').map((c) => c.bass)).toEqual(['C', 'E', 'G']);
    expect(inversionChoices('G7').map((c) => c.name)).toEqual(['기본형', '1전위', '2전위', '3전위']);
    expect(playedInversion([52, 60, 67], 'C')).toBe(1);
    expect(playedInversion([55, 60, 64], 'C')).toBe(2);
    expect(playedInversion([65, 67, 71, 74], 'G7')).toBe(3);
  });

  it('asks for the smooth inversion after what was played', () => {
    // after C (C4 E4 G4), the closest F is C4 F4 A4 → 2nd inversion (C in the bass)
    expect(pickInversion('F', 'smooth', [60, 64, 67], () => 0)!.bass).toBe('C');
    // after C (C4 E4 G4), the closest G is B3 D4 G4 → 1st inversion
    expect(pickInversion('G', 'smooth', [60, 64, 67], () => 0)!.bass).toBe('B');
    expect(pickInversion('C', 'free', undefined, () => 0)).toBeNull();
  });
});
