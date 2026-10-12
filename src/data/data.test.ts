import { Chord } from 'tonal';
import { describe, expect, it } from 'vitest';
import { splitSlash } from '../theory/notes';
import { parseBars, progressionToChords } from '../theory/roman';
import { GENRES, PROGRESSIONS } from './progressions';
import { RHYTHM_BY_ID } from './rhythms';
import { SONGS } from './songs';

describe('content data', () => {
  it('every progression resolves to real chords and a known rhythm', () => {
    for (const p of PROGRESSIONS) {
      expect(RHYTHM_BY_ID[p.rhythm], p.id).toBeDefined();
      for (const c of progressionToChords(p.numerals, p.key)) {
        expect(Chord.get(splitSlash(c.symbol)[0]).empty, `${p.id}: ${c.symbol}`).toBe(false);
      }
      const total = progressionToChords(p.numerals, p.key).reduce((a, c) => a + c.beats, 0);
      expect(total % 4, p.id).toBe(0);
    }
  });
  it('every song has real chords and a known rhythm', () => {
    for (const s of SONGS) {
      expect(RHYTHM_BY_ID[s.rhythm], s.id).toBeDefined();
      for (const sec of s.sections) for (const c of parseBars(sec.chords)) expect(Chord.get(splitSlash(c.symbol)[0]).empty, `${s.id}: ${c.symbol}`).toBe(false);
    }
  });
  it('subtype ids exist on their genre and every subtype has progressions', () => {
    for (const g of GENRES.filter((x) => x.subtypes)) {
      const ids = g.subtypes!.map((s) => s.id);
      const inGenre = PROGRESSIONS.filter((p) => p.genres.includes(g.id));
      for (const p of inGenre) if (p.subtype) expect(ids, p.id).toContain(p.subtype);
      for (const id of ids) expect(inGenre.filter((p) => p.subtype === id).length, id).toBeGreaterThanOrEqual(2);
      for (const r of g.rhythms) expect(RHYTHM_BY_ID[r], r).toBeDefined();
    }
  });
});
