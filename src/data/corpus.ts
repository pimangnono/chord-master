import { parseBars, progressionToChords } from '../theory/roman';
import { buildTransitionStats } from '../theory/suggest';
import { PROGRESSIONS } from './progressions';
import { SONGS } from './songs';

let statsCache: ReturnType<typeof buildTransitionStats> | null = null;
/** Chord-to-chord move counts from every progression and song in the app. */
export function corpusStats() {
  if (!statsCache) {
    statsCache = buildTransitionStats([
      ...PROGRESSIONS.map((p) => ({ key: p.key, chords: progressionToChords(p.numerals, p.key) })),
      ...SONGS.flatMap((s) => s.sections.map((sec) => ({ key: s.key, chords: parseBars(sec.chords) }))),
    ]);
  }
  return statsCache;
}

