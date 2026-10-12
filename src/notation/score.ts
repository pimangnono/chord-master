import { Note } from 'tonal';
import type { Arrangement, NoteEvent } from '../theory/arrange';
import type { ChordEvent } from '../theory/roman';

export const STEPS_PER_BAR = 16; // 16th-note grid in 4/4

export interface ScoreItem {
  start: number; // in 16ths from bar start
  len: number; // in 16ths
  notes: string[] | null; // null = rest
  tieToNext?: boolean;
  /** continues a note tied over from the previous bar (not a new key press) */
  cont?: boolean;
  chord: number;
}

export interface ScoreBar {
  index: number;
  rh: ScoreItem[];
  lh: ScoreItem[];
  marks: { pos: number; symbol: string; chord: number }[];
}

interface Raw {
  start: number;
  len: number;
  notes: string[];
  chord: number;
}

function mergeHand(events: NoteEvent[]): Raw[] {
  const byStart = new Map<number, Raw>();
  for (const e of events) {
    const start = Math.round(e.t * 4);
    const len = Math.max(1, Math.round(e.d * 4));
    const cur = byStart.get(start);
    if (cur) {
      for (const n of e.notes) if (!cur.notes.some((m) => Note.midi(m) === Note.midi(n))) cur.notes.push(n);
      cur.len = Math.max(cur.len, len);
    } else {
      byStart.set(start, { start, len, notes: [...e.notes], chord: e.chord });
    }
  }
  const list = [...byStart.values()].sort((a, b) => a.start - b.start);
  for (let i = 0; i < list.length - 1; i++) list[i].len = Math.min(list[i].len, list[i + 1].start - list[i].start);
  for (const r of list) r.notes.sort((a, b) => (Note.midi(a) ?? 0) - (Note.midi(b) ?? 0));
  return list;
}

function toBars(raws: Raw[], barCount: number): ScoreItem[][] {
  const bars: ScoreItem[][] = Array.from({ length: barCount }, () => []);
  for (const r of raws) {
    let start = r.start;
    let len = Math.min(r.len, barCount * STEPS_PER_BAR - r.start);
    let first = true;
    while (len > 0) {
      const bar = Math.floor(start / STEPS_PER_BAR);
      const pos = start % STEPS_PER_BAR;
      const piece = Math.min(len, STEPS_PER_BAR - pos);
      bars[bar]?.push({ start: pos, len: piece, notes: r.notes, tieToNext: piece < len, cont: !first, chord: r.chord });
      first = false;
      len -= piece;
      start += piece;
    }
  }
  // fill gaps with rests
  return bars.map((items) => {
    const out: ScoreItem[] = [];
    let cursor = 0;
    for (const it of items) {
      if (it.start > cursor) out.push({ start: cursor, len: it.start - cursor, notes: null, chord: it.chord });
      out.push(it);
      cursor = it.start + it.len;
    }
    if (cursor < STEPS_PER_BAR) out.push({ start: cursor, len: STEPS_PER_BAR - cursor, notes: null, chord: items.at(-1)?.chord ?? 0 });
    return out;
  });
}

export function buildScore(arr: Arrangement, chords: ChordEvent[]): ScoreBar[] {
  const barCount = Math.max(1, Math.ceil(arr.total / 4 - 1e-6));
  const rh = toBars(mergeHand(arr.events.filter((e) => e.hand === 'rh')), barCount);
  const lh = toBars(mergeHand(arr.events.filter((e) => e.hand === 'lh')), barCount);
  const bars: ScoreBar[] = rh.map((items, index) => ({ index, rh: items, lh: lh[index], marks: [] }));
  chords.forEach((c, i) => {
    const s = Math.round(arr.starts[i] * 4);
    const bar = Math.floor(s / STEPS_PER_BAR);
    bars[bar]?.marks.push({ pos: s % STEPS_PER_BAR, symbol: c.symbol, chord: i });
  });
  return bars;
}

const DURATIONS: [number, string][] = [
  [16, 'w'],
  [12, 'hd'],
  [8, 'h'],
  [6, 'qd'],
  [4, 'q'],
  [3, '8d'],
  [2, '8'],
  [1, '16'],
];

/**
 * Splits a length (16ths) starting at `start` into notatable durations,
 * keeping off-beat notes inside their beat the way engravers do.
 */
export function splitDuration(start: number, len: number): { start: number; len: number; dur: string }[] {
  const out: { start: number; len: number; dur: string }[] = [];
  let pos = start;
  let left = len;
  while (left > 0) {
    let pick: [number, string] = DURATIONS[DURATIONS.length - 1];
    for (const d of DURATIONS) {
      const [n] = d;
      if (n > left) continue;
      const toBeat = 4 - (pos % 4);
      if (n > 4 && pos % 4 !== 0) continue; // long values start on a beat
      if (n === 12 && pos % 8 !== 0 && pos !== 4) continue;
      if (n === 8 && pos % 4 !== 0) continue;
      if (n === 6 && pos % 4 !== 0) continue;
      if (n <= 4 && pos % 4 !== 0 && n > toBeat) continue; // off-beat values stay within the beat
      if (n === 3 && pos % 2 !== 0) continue;
      pick = d;
      break;
    }
    out.push({ start: pos, len: pick[0], dur: pick[1] });
    pos += pick[0];
    left -= pick[0];
  }
  return out;
}

/** "C#4" → "c#/4" */
export function vexKey(note: string): string {
  const n = Note.get(note);
  return `${n.letter.toLowerCase()}${n.acc}/${n.oct}`;
}

export type Hands = 'both' | 'rh' | 'lh';

export interface FollowStep {
  /** absolute position in 16ths — matches the notation grid */
  t16: number;
  /** MIDI notes to press at this moment */
  notes: number[];
}

/** The key presses of an arrangement, in order, for wait-mode practice. */
export function buildFollowSteps(arr: Arrangement, hands: Hands): FollowStep[] {
  const byT = new Map<number, Set<number>>();
  for (const e of arr.events) {
    if (hands !== 'both' && e.hand !== hands) continue;
    const t16 = Math.round(e.t * 4);
    const set = byT.get(t16) ?? new Set<number>();
    for (const n of e.notes) set.add(Note.midi(n)!);
    byT.set(t16, set);
  }
  return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t16, set]) => ({ t16, notes: [...set].sort((a, b) => a - b) }));
}
