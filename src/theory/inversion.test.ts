import { describe, expect, it } from 'vitest';
import { analyzeInversions, bassSuggestions, inversionOf } from './inversion';
import { voiceChord, voiceProgression } from './voicing';

describe('inversions', () => {
  it('names inversions by the lowest right-hand note', () => {
    expect(inversionOf(voiceChord('C', undefined, 'root')).name).toBe('기본형');
    const [, f] = voiceProgression(['C', 'F']);
    // C(E-G-C or C-E-G) → F moves to C-F-A (2nd inversion) to keep the common tone C
    expect(f.rh.map((n) => n.replace(/\d/, ''))).toContain('C');
    expect(['1전위', '2전위']).toContain(inversionOf(f).name);
  });

  it('smooth voice-leading moves the hand less than root position', () => {
    const a = analyzeInversions(['C', 'G', 'Am', 'F']);
    expect(a.smoothTotal).toBeLessThan(a.rootTotal);
    expect(a.root.every((r) => r.inversion.number === 0)).toBe(true);
    expect(a.smooth.slice(1).some((r) => r.inversion.number > 0)).toBe(true);
    expect(a.smooth[1].motion!.common.length).toBeGreaterThan(0); // C and G share G
  });

  it('suggests slash chords for a stepwise bass', () => {
    const s = bassSuggestions(['C', 'G', 'Am', 'F']);
    // C → G leaps a 4th; G/B steps down a half step from C
    expect(s[0]).toMatchObject({ index: 1, symbol: 'G/B', step: -1 });
    expect(bassSuggestions(['C', 'G/B', 'Am'])).toHaveLength(0);
  });
});
