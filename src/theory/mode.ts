import { Chord } from 'tonal';
import { TEMPLATES } from './detect';
import { keyUsesFlats, MAJOR_KEYS, MINOR_KEYS, parseKey } from './keys';
import { chroma, pcName, PC_SHARP, splitSlash } from './notes';
import type { ChordEvent } from './roman';

/** The parallel key (same tonic, other mode), spelled as the key pickers spell it: C → Cm, Db → C#m. */
export function parallelKey(key: string): string {
  const { tonic, minor } = parseKey(key);
  const pc = chroma(tonic);
  const list = minor ? MAJOR_KEYS : MINOR_KEYS;
  return list.find((k) => chroma(parseKey(k).tonic) === pc) ?? (minor ? tonic : tonic + 'm');
}

const MAJOR_SCALE = new Set([0, 2, 4, 5, 7, 9, 11]);
const MINOR_SCALE = new Set([0, 2, 3, 5, 7, 8, 10, 11]); // natural minor + harmonic leading tone

/** Suffix for a set of pitch classes over a root, in the app's chord vocabulary. */
function suffixFor(root: number, pcs: number[]): string | undefined {
  const rel = new Set(pcs.map((p) => (p - root + 12) % 12));
  for (const t of TEMPLATES) {
    if (t.tones.length === rel.size && t.tones.every((x) => rel.has(x))) return t.suffix;
  }
  for (const name of Chord.detect(pcs.map((p) => PC_SHARP[p]))) {
    const c = Chord.get(name);
    if (!name.includes('/') && c.tonic && chroma(c.tonic) === root) {
      const suf = name.slice(c.tonic.length);
      return suf === 'M' ? '' : suf.replace(/^M(?=\d)/, 'maj');
    }
  }
  return undefined;
}

/**
 * Re-harmonises a progression in the parallel mode (C major ↔ C minor) the
 * way players do it by ear: scale degrees 3, 6 and 7 move a half step
 * (E A B ↔ E♭ A♭ B♭ in C) and every diatonic chord is renamed from its new
 * notes — Am → A♭, Dm7 → Dm7♭5, Fmaj7 → Fm7. Dominant chords on V keep the
 * leading tone so cadences still resolve, and minor's ♭VII becomes V in
 * major. Chromatic chords (secondary dominants, borrowed chords) keep their
 * quality and only move their root.
 */
export function convertMode(chords: ChordEvent[], fromKey: string): { key: string; chords: ChordEvent[] } {
  const { tonic, minor } = parseKey(fromKey);
  const toKey = parallelKey(fromKey);
  const t = chroma(tonic);
  const flats = keyUsesFlats(toKey);
  const scale = minor ? MINOR_SCALE : MAJOR_SCALE;
  const map: Record<number, number> = minor ? { 3: 4, 8: 9, 10: 11 } : { 4: 3, 9: 8, 11: 10 };
  const mapPc = (pc: number, keepLeading: boolean) => {
    const rel = (pc - t + 12) % 12;
    if (keepLeading && rel === 11) return pc;
    const to = map[rel];
    return to === undefined ? pc : (t + to) % 12;
  };

  const out = chords.map((ev) => {
    const [main, bass] = splitSlash(ev.symbol);
    const c = Chord.get(main);
    if (c.empty || !c.tonic) return ev;
    const root = chroma(c.tonic);
    const rootRel = (root - t + 12) % 12;
    const pcs = c.notes.map(chroma);
    const isDominant = c.intervals.includes('3M') && (c.intervals.includes('7m') || rootRel === 7);
    const keepLeading = rootRel === 7 && isDominant;
    const diatonic = pcs.every((p) => scale.has((p - t + 12) % 12));
    // Minor → major: the subtonic ♭VII would become a bare vii°; players use V there instead.
    if (minor && rootRel === 10 && c.quality === 'Major') {
      const v = (t + 7) % 12;
      // a slash bass keeps its interval above the root (G/B → E/G#)
      const newBass = bass ? (v + chroma(bass) - root + 12) % 12 : v;
      return { ...ev, symbol: pcName(v, flats) + main.slice(c.tonic.length) + (newBass !== v ? '/' + pcName(newBass, flats) : '') };
    }
    const newRoot = mapPc(root, keepLeading);
    let suffix = main.slice(c.tonic.length);
    if (diatonic || keepLeading) {
      const found = suffixFor(newRoot, pcs.map((p) => mapPc(p, keepLeading)));
      if (found !== undefined) suffix = found;
    }
    let symbol = pcName(newRoot, flats) + suffix;
    if (bass) {
      const b = mapPc(chroma(bass), keepLeading);
      if (b !== newRoot) symbol += '/' + pcName(b, flats);
    }
    return { ...ev, symbol };
  });
  return { key: toKey, chords: out };
}
