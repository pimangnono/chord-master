import { describe, expect, it } from 'vitest';
import { normalizeChord, parseChordSheet, sectionName, toBarText } from './sheet';

describe('chord sheet import', () => {
  it('normalises chord spellings', () => {
    expect(normalizeChord('Cmaj7')).toBe('Cmaj7');
    expect(normalizeChord('Bbmin7')).toBe('Bbm7');
    expect(normalizeChord('F#m7(b5)')).toBe('F#m7b5');
    expect(normalizeChord('Gsus')).toBe('Gsus4');
    expect(normalizeChord('C-7')).toBe('Cm7');
    expect(normalizeChord('D/F#')).toBe('D/F#');
    expect(normalizeChord('B♭')).toBe('Bb');
    expect(normalizeChord('Hello')).toBeUndefined();
    expect(normalizeChord('Am')).toBe('Am');
  });

  it('recognises section headings', () => {
    expect(sectionName('[Verse 2]')).toBe('벌스 2');
    expect(sectionName('Chorus:')).toBe('후렴');
    expect(sectionName('[Pre-Chorus]')).toBe('프리코러스');
    expect(sectionName('(브릿지)')).toBe('브릿지');
    expect(sectionName('When I find myself in times of trouble')).toBeUndefined();
  });

  it('extracts chords from chords-over-lyrics and drops the lyrics', () => {
    const sheet = `Let It Be - Example
[Verse 1]
C                G
When I find myself in times of trouble
Am          F
Mother Mary comes to me
C            G        F  C
Speaking words of wisdom, let it be

[Chorus]
Am   G   F   C
Let it be, let it be
C  G  F  C

[Verse 2]
C                G
And in my hour of darkness
Am          F
She is standing right in front of me
C            G        F  C
Speaking words of wisdom, let it be`;
    const r = parseChordSheet(sheet);
    expect(r.sections.map((s) => s.name)).toEqual(['벌스 1', '후렴']); // verse 2 repeats verse 1
    expect(r.sections[0].chords).toEqual(['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C']);
    expect(r.sections[1].chords).toEqual(['Am', 'G', 'F', 'C', 'C', 'G', 'F', 'C']);
    expect(r.key).toBe('C');
  });

  it('reads ChordPro, repeats and capo', () => {
    const r = parseChordSheet('Capo 2\n{title: x}\n[G]Hello [D]there [Em]my [C]friend\nG D Em C x2');
    expect(r.capo).toBe(2);
    // capo 2: G shapes sound as A
    expect(r.sections[0].chords.slice(0, 4)).toEqual(['A', 'E', 'F#m', 'D']);
    expect(r.sections[0].chords).toHaveLength(12);
    expect(parseChordSheet('Capo 2\nG D Em C', false).sections[0].chords).toEqual(['G', 'D', 'Em', 'C']);
  });

  it('formats bars', () => {
    expect(toBarText(['C', 'G', 'Am', 'F'], 2)).toBe('C G | Am F');
    expect(toBarText(['C', 'G'])).toBe('C | G');
  });
});
