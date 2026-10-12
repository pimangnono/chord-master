import { Interval, Key, Note } from 'tonal';
import { splitSlash } from './notes';

export interface KeyInfo {
  tonic: string;
  minor: boolean;
}

/** Keys offered in pickers, spelled the way musicians normally write them. */
export const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

export function parseKey(key: string): KeyInfo {
  const minor = /m$/.test(key) && !/maj$/.test(key);
  const tonic = minor ? key.slice(0, -1) : key;
  return { tonic, minor };
}

export function keyLabel(key: string): string {
  const { tonic, minor } = parseKey(key);
  const t = tonic.replace('#', '♯').replace('b', '♭');
  return minor ? `${t} 단조 (${t}m)` : `${t} 장조 (${t})`;
}

export function shortKeyLabel(key: string): string {
  return key.replace('#', '♯').replace(/^([A-G])b/, '$1♭');
}

/** Number of sharps (>0) or flats (<0) in the key signature. */
export function keyAlteration(key: string): number {
  const { tonic, minor } = parseKey(key);
  return minor ? Key.minorKey(tonic).alteration : Key.majorKey(tonic).alteration;
}

export function keyUsesFlats(key: string): boolean {
  return keyAlteration(key) < 0;
}

/** Key signature string understood by VexFlow ("Bb", "F#m", ...). */
export function vexKeySignature(key: string): string {
  return key;
}

export function keyTonicChroma(key: string): number {
  return Note.chroma(parseKey(key).tonic) ?? 0;
}

/** Shift a note name by an accidental delta (+1 sharp, -1 flat), keeping the letter. */
export function alterNote(note: string, delta: number): string {
  const n = Note.get(note);
  if (n.empty) return note;
  const alt = n.alt + delta;
  const acc = alt > 0 ? '#'.repeat(alt) : 'b'.repeat(-alt);
  return n.letter + acc + (n.oct ?? '');
}

function tidy(note: string): string {
  const n = Note.get(note);
  if (n.empty) return note;
  return Math.abs(n.alt) >= 2 ? Note.simplify(note) : note;
}

export function transposeNote(note: string, ivl: string): string {
  return tidy(Note.transpose(note, ivl));
}

/** Transpose a chord symbol ("E/G#", "Bbm7b5") by an interval. */
export function transposeChord(symbol: string, ivl: string): string {
  if (ivl === '1P') return symbol;
  const [main, bass] = splitSlash(symbol);
  const m = main.match(/^([A-G][#b]*)(.*)$/);
  if (!m) return symbol;
  const root = transposeNote(m[1], ivl);
  const out = root + m[2];
  return bass ? `${out}/${transposeNote(bass, ivl)}` : out;
}

export function intervalBetweenKeys(from: string, to: string): string {
  const a = parseKey(from).tonic;
  const b = parseKey(to).tonic;
  return Interval.distance(a, b) || '1P';
}

export function keyOptionsFor(minor: boolean): string[] {
  return minor ? MINOR_KEYS : MAJOR_KEYS;
}
