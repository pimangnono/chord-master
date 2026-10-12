import { Note } from 'tonal';

/** 고정도법 계이름 */
const SOLFEGE: Record<string, string> = { C: '도', D: '레', E: '미', F: '파', G: '솔', A: '라', B: '시' };

export const SOLFEGE_LIST = ['도', '레', '미', '파', '솔', '라', '시'];
export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Spelling most players expect when no key is given. */
export const PC_NEUTRAL = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function prettyAcc(acc: string): string {
  return acc.replace(/##/g, '𝄪').replace(/#/g, '♯').replace(/bb/g, '𝄫').replace(/b/g, '♭');
}

/** "Bb4" → "시♭" */
export function solfege(note: string): string {
  const n = Note.get(note);
  if (n.empty) return note;
  return SOLFEGE[n.letter] + prettyAcc(n.acc);
}

/** "Bb4" → "B♭4" */
export function prettyNote(note: string): string {
  const n = Note.get(note);
  if (n.empty) return note;
  return n.letter + prettyAcc(n.acc) + (n.oct ?? '');
}

/** "Bbm7b5/F" → "B♭m7♭5/F" */
export function prettyChord(symbol: string): string {
  const [main, bass] = splitSlash(symbol);
  const m = main.match(/^([A-G])([#b]*)(.*)$/);
  if (!m) return symbol;
  const suffix = m[3].replace(/b(\d)/g, '♭$1').replace(/#(\d)/g, '♯$1');
  const out = m[1] + prettyAcc(m[2]) + suffix;
  return bass ? `${out}/${prettyNote(bass)}` : out;
}

/** Splits "E/G#" into ["E", "G#"]; "C6/9" is not a slash chord. */
export function splitSlash(symbol: string): [string, string | undefined] {
  const m = symbol.match(/^(.*)\/([A-G][#b]*)$/);
  if (m) return [m[1], m[2]];
  return [symbol, undefined];
}

export function chroma(note: string): number {
  return Note.chroma(note) ?? 0;
}

export function midiOf(note: string): number {
  return Note.midi(note) ?? 60;
}

/** Spell a pitch class (0-11) using flats, sharps, or (undefined) the common neutral spelling. */
export function pcName(pc: number, preferFlats?: boolean): string {
  const i = ((pc % 12) + 12) % 12;
  if (preferFlats === undefined) return PC_NEUTRAL[i];
  return preferFlats ? PC_FLAT[i] : PC_SHARP[i];
}

export function midiToNote(midi: number, preferFlats?: boolean): string {
  return pcName(midi % 12, preferFlats) + (Math.floor(midi / 12) - 1);
}

/** Give a (correctly spelled) pitch class the octave that lands on the given midi number. */
export function nameAtMidi(pc: string, midi: number): string {
  for (let oct = -1; oct <= 9; oct++) {
    if (Note.midi(pc + oct) === midi) return pc + oct;
  }
  return midiToNote(midi);
}

/** Lowest midi >= min with the given pitch class. */
export function midiAtOrAbove(pc: string, min: number): number {
  const c = chroma(pc);
  let m = min + ((c - (min % 12) + 12) % 12);
  return m;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}
