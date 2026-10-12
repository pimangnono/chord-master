import { describe, expect, it } from 'vitest';
import { convertMode, parallelKey } from './mode';
import { parseBars } from './roman';

const conv = (text: string, key: string) => convertMode(parseBars(text), key);

describe('major ↔ minor conversion', () => {
  it('finds the parallel key', () => {
    expect(parallelKey('C')).toBe('Cm');
    expect(parallelKey('Db')).toBe('C#m');
    expect(parallelKey('Am')).toBe('A');
    expect(parallelKey('Ebm')).toBe('Eb');
  });

  it('turns a major pop progression minor', () => {
    const r = conv('C | G | Am | F', 'C');
    expect(r.key).toBe('Cm');
    expect(r.chords.map((c) => c.symbol)).toEqual(['Cm', 'G', 'Ab', 'Fm']);
  });

  it('keeps cadences and renames sevenths', () => {
    expect(conv('Dm7 | G7 | Cmaj7', 'C').chords.map((c) => c.symbol)).toEqual(['Dm7b5', 'G7', 'Cm7']);
    expect(conv('Fmaj9 | E7 | Am', 'C').chords.map((c) => c.symbol)).toEqual(['Fm9', 'Eb7', 'Ab']);
  });

  it('turns a minor progression major', () => {
    expect(conv('Am | F | C | G', 'Am').chords.map((c) => c.symbol)).toEqual(['A', 'F#m', 'C#m', 'E']);
    expect(conv('Am | G7 | C', 'Am').chords.map((c) => c.symbol)).toEqual(['A', 'E7', 'C#m']);
    expect(conv('Am | G/B | C', 'Am').chords.map((c) => c.symbol)).toEqual(['A', 'E/G#', 'C#m']);
    expect(conv('Am | E7 | Am', 'Am').chords.map((c) => c.symbol)).toEqual(['A', 'E7', 'A']);
  });

  it('maps slash basses and round-trips simple progressions', () => {
    expect(conv('C | G/B | Am', 'C').chords.map((c) => c.symbol)).toEqual(['Cm', 'G/B', 'Ab']);
    const there = conv('C | F | G | C', 'C');
    const back = convertMode(there.chords, there.key);
    expect(back.key).toBe('C');
    expect(back.chords.map((c) => c.symbol)).toEqual(['C', 'F', 'G', 'C']);
  });
});
