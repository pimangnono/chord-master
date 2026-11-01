import { chordInfo } from './voicing';
import { chroma, midiToNote } from './notes';
import { diatonicChords, harmonicFunction, romanToChord } from './roman';
import { intervalBetweenKeys, keyUsesFlats, parseKey, transposeChord } from './keys';
import { Interval } from 'tonal';

/** Melody range shown on the keyboard: C4–B5. */
export const LOW = 60;
export const HIGH = 83;
export const BEATS_PER_BAR = 4;
export const MAX_BARS = 16;
export const MAX_NOTES = 128;

/** One melody step. `midi: null` is a rest. Durations are in beats. */
export interface MelodyNote {
  midi: number | null;
  dur: number;
}

export interface Song {
  key: string;
  bpm: number;
  /** one chord per bar */
  chords: string[];
  melody: MelodyNote[];
}

export interface Mood {
  id: string;
  emoji: string;
  name: string;
  blurb: string;
  key: string;
  bpm: number;
  numerals: string[];
}

export const MOODS: Mood[] = [
  { id: 'sunny', emoji: '☀️', name: '햇살처럼 밝게', blurb: '산뜻한 장조, 기분 좋은 출발', key: 'C', bpm: 104, numerals: ['I', 'V', 'vi', 'IV'] },
  { id: 'calm', emoji: '🌙', name: '조용한 밤', blurb: '느리고 포근한 분위기', key: 'F', bpm: 72, numerals: ['Imaj7', 'iii7', 'IVmaj7', 'V7'] },
  { id: 'rain', emoji: '🌧️', name: '비 오는 창가', blurb: '살짝 쓸쓸한 단조', key: 'Am', bpm: 80, numerals: ['i', 'bVI', 'bIII', 'bVII'] },
  { id: 'flutter', emoji: '💗', name: '두근두근', blurb: '설레는 고백 같은 진행', key: 'G', bpm: 116, numerals: ['IV', 'V', 'iii', 'vi'] },
  { id: 'drive', emoji: '🚗', name: '드라이브', blurb: '창문 열고 달리는 느낌', key: 'D', bpm: 124, numerals: ['I', 'bVII', 'IV', 'I'] },
];

export function moodSong(mood: Mood): Song {
  return { key: mood.key, bpm: mood.bpm, chords: mood.numerals.map((n) => romanToChord(n, mood.key)), melody: [] };
}

export const DEFAULT_SONG: Song = moodSong(MOODS[0]);

/** Scale pitch classes; minor keys also allow the raised 7th (the V chord uses it). */
export function scalePcs(key: string): number[] {
  const { tonic, minor } = parseKey(key);
  const t = chroma(tonic);
  const steps = minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11];
  return steps.map((s) => (t + s) % 12);
}

export function chordPcs(symbol: string): number[] {
  const info = chordInfo(symbol);
  const pcs = info.notes.map(chroma);
  if (info.bass) pcs.push(chroma(info.bass));
  return [...new Set(pcs)];
}

export function chordRootPc(symbol: string): number {
  return chroma(chordInfo(symbol).root);
}

export function totalBeats(melody: MelodyNote[]): number {
  return melody.reduce((s, n) => s + n.dur, 0);
}

/** Start beat of every melody step. */
export function noteStarts(melody: MelodyNote[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const n of melody) {
    out.push(t);
    t += n.dur;
  }
  return out;
}

export function barAt(beat: number): number {
  return Math.floor(beat / BEATS_PER_BAR + 1e-9);
}

/** Beats left in the bar that starts at or contains `beat`. */
export function beatsLeftInBar(beat: number): number {
  return BEATS_PER_BAR - (beat - barAt(beat) * BEATS_PER_BAR);
}

export function lastPitch(melody: MelodyNote[]): number | null {
  for (let i = melody.length - 1; i >= 0; i--) if (melody[i].midi !== null) return melody[i].midi;
  return null;
}

export type NoteKind = 'chord' | 'scale' | 'other';

export function noteKind(midi: number, chord: string, key: string): NoteKind {
  const pc = midi % 12;
  if (chordPcs(chord).includes(pc)) return 'chord';
  if (scalePcs(key).includes(pc)) return 'scale';
  return 'other';
}

export interface NoteIdea {
  midi: number;
  reason: string;
  score: number;
}

/** Small deterministic PRNG so "다른 후보" reshuffles reproducibly in tests. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/**
 * Rank candidate next notes. Ideas favour chord tones on strong beats, stepwise
 * motion after a note, resolving the leading tone, and the tonic at the very end.
 */
export function suggestNotes(song: Song, opts: { count?: number; seed?: number } = {}): NoteIdea[] {
  const { count = 4, seed = 1 } = opts;
  const pos = totalBeats(song.melody);
  const bar = barAt(pos);
  if (bar >= song.chords.length) return [];
  const chord = song.chords[bar];
  const tones = chordPcs(chord);
  const root = chordRootPc(chord);
  const scale = scalePcs(song.key);
  const tonic = chroma(parseKey(song.key).tonic);
  const leading = (tonic + 11) % 12;
  const prev = lastPitch(song.melody);
  const downbeat = Math.abs(pos - bar * BEATS_PER_BAR) < 1e-9;
  const strong = downbeat || Math.abs((pos % 2) - 0) < 1e-9;
  const endBeats = song.chords.length * BEATS_PER_BAR;
  const nearEnd = endBeats - pos <= BEATS_PER_BAR;
  const rand = rng(seed * 7919 + song.melody.length * 31 + 1);

  const ideas: NoteIdea[] = [];
  for (let m = LOW; m <= HIGH; m++) {
    const pc = m % 12;
    const isChord = tones.includes(pc);
    if (!isChord && !scale.includes(pc)) continue;
    let score = isChord ? 3 : 1;
    let reason = isChord ? (pc === root ? '코드의 뿌리음 — 가장 안정적' : '코드 구성음 — 잘 어울려요') : '음계 음 — 사이를 이어줘요';
    if (isChord && strong) score += 1.5;
    if (!isChord && strong) score -= 0.8;
    if (prev === null) {
      score += m >= 64 && m <= 72 ? 1.5 : -Math.abs(m - 68) / 6;
    } else {
      const leap = Math.abs(m - prev);
      if (leap === 0) {
        score += 0.4;
        reason = '같은 음 반복 — 리듬으로 강조';
      } else if (leap <= 2) {
        score += 2.5;
        if (!isChord) reason = '바로 옆 음 — 부드럽게 흘러가요';
      } else if (leap <= 4) score += 1.4;
      else if (leap <= 7) score += 0.3;
      else {
        score -= 1.6 + (leap - 7) * 0.25;
        reason = '크게 도약 — 극적인 느낌';
      }
      if (prev % 12 === leading && pc === tonic && leap <= 2) {
        score += 2.5;
        reason = '이끔음에서 으뜸음으로 해결';
      }
    }
    if (nearEnd && pc === tonic) {
      score += 2;
      if (isChord) reason = '으뜸음 — 곡이 끝난 느낌';
    }
    score += rand() * 1.8;
    ideas.push({ midi: m, reason, score });
  }
  ideas.sort((a, b) => b.score - a.score);
  // Keep the shortlist varied: no two ideas on the same pitch class.
  const out: NoteIdea[] = [];
  const seen = new Set<number>();
  for (const i of ideas) {
    if (seen.has(i.midi % 12)) continue;
    seen.add(i.midi % 12);
    out.push(i);
    if (out.length === count) break;
  }
  return out;
}

type Fn = 'T' | 'S' | 'D';

export function chordFn(symbol: string, key: string): Fn {
  const c = harmonicFunction(symbol, key).code;
  if (c === 'T') return 'T';
  if (c === 'D' || c === 'SD') return 'D';
  return 'S';
}

export const FN_LABEL: Record<Fn, string> = { T: '안정', S: '펼침', D: '긴장' };

const FLOW: Record<Fn, Record<Fn, number>> = {
  T: { T: 0.8, S: 3, D: 2 },
  S: { T: 1.6, S: 1.2, D: 3 },
  D: { T: 3.5, S: 0.6, D: 0.8 },
};

function rootMotion(a: string, b: string): number {
  const d = (chordRootPc(b) - chordRootPc(a) + 12) % 12;
  if (d === 5) return 1.6; // down a fifth / up a fourth
  if (d === 0) return -1.5;
  if (d === 2 || d === 10) return 0.8;
  if (d === 3 || d === 4 || d === 8 || d === 9) return 0.5;
  return 0;
}

function link(a: string, b: string, key: string): number {
  return FLOW[chordFn(a, key)][chordFn(b, key)] + rootMotion(a, b);
}

export interface ChordIdea {
  symbol: string;
  fn: Fn;
  why: string;
}

/** Chords that connect well between the neighbours of bar `index`. */
export function suggestChords(chords: string[], index: number, key: string, count = 4): ChordIdea[] {
  const prev = index > 0 ? chords[index - 1] : undefined;
  const next = index < chords.length - 1 ? chords[index + 1] : chords.length > 1 ? chords[0] : undefined;
  const pool = [...diatonicChords(key), ...diatonicChords(key, true)].map((c) => c.symbol);
  const current = chords[index];
  const scored = [...new Set(pool)]
    .filter((s) => s !== current)
    .map((s) => {
      let score = 0;
      if (prev) score += link(prev, s, key);
      if (next) score += link(s, next, key) * 0.8;
      if (index === 0 && chordFn(s, key) === 'T') score += 2;
      if (/7/.test(s)) score -= 0.4; // keep plain triads slightly ahead for beginners
      return { s, score };
    })
    .sort((a, b) => b.score - a.score);
  const out: ChordIdea[] = [];
  const roots = new Set<number>();
  for (const { s } of scored) {
    const r = chordRootPc(s);
    if (roots.has(r)) continue;
    roots.add(r);
    const fn = chordFn(s, key);
    const why = prev ? `${FN_LABEL[chordFn(prev, key)]} → ${FN_LABEL[fn]}` : `${FN_LABEL[fn]}으로 시작`;
    out.push({ symbol: s, fn, why });
    if (out.length === count) break;
  }
  return out;
}

/** The two ways to finish the last bar: hang on the dominant, or land on the tonic. */
export function endingChords(key: string): { loop: string; close: string } {
  return { loop: romanToChord('V7', key), close: romanToChord(parseKey(key).minor ? 'i' : 'I', key) };
}

/** Move a song to a new key, keeping the melody inside the keyboard range. */
export function transposeSong(song: Song, toKey: string): Song {
  const ivl = intervalBetweenKeys(song.key, toKey);
  let semis = Interval.semitones(ivl) ?? 0;
  if (semis > 6) semis -= 12;
  const chords = song.chords.map((c) => transposeChord(c, ivl));
  const melody = song.melody.map((n) => {
    if (n.midi === null) return n;
    let m = n.midi + semis;
    while (m < LOW) m += 12;
    while (m > HIGH) m -= 12;
    return { ...n, midi: m };
  });
  return { ...song, key: toKey, chords, melody };
}

export function noteName(midi: number, key: string): string {
  return midiToNote(midi, keyUsesFlats(key));
}

/* ───────── share links ───────── */

const DUR_CODES: Record<string, number> = { e: 0.5, q: 1, d: 1.5, h: 2, t: 3, w: 4 };
const CODE_OF = Object.fromEntries(Object.entries(DUR_CODES).map(([k, v]) => [v, k]));

/** Compact, URL-safe text: `1|key|bpm|C.G.Am.F|60q,62q,_h` (`_` = rest). */
export function encodeSong(song: Song): string {
  const mel = song.melody.map((n) => `${n.midi === null ? '_' : n.midi}${CODE_OF[n.dur] ?? `~${n.dur}`}`).join(',');
  return ['1', song.key, String(song.bpm), song.chords.join('.'), mel].join('|');
}

export function decodeSong(text: string): Song | null {
  const parts = text.split('|');
  if (parts.length !== 5 || parts[0] !== '1') return null;
  const [, key, bpmText, chordText, melText] = parts;
  const bpm = Number(bpmText);
  if (!/^[A-G][#b]?m?$/.test(key) || !Number.isFinite(bpm)) return null;
  const chords = chordText.split('.').filter(Boolean);
  if (!chords.length || chords.length > MAX_BARS || chords.some((c) => chordInfo(c).empty)) return null;
  const melody: MelodyNote[] = [];
  if (melText) {
    for (const tok of melText.split(',')) {
      const m = tok.match(/^(_|\d{2,3})(?:([eqdhtw])|~([\d.]+))$/);
      if (!m) return null;
      const dur = m[2] ? DUR_CODES[m[2]] : Number(m[3]);
      const midi = m[1] === '_' ? null : Number(m[1]);
      if (!(dur > 0) || (midi !== null && (midi < LOW || midi > HIGH))) return null;
      melody.push({ midi, dur });
    }
  }
  if (melody.length > MAX_NOTES || totalBeats(melody) > chords.length * BEATS_PER_BAR + 1e-9) return null;
  return { key, bpm: Math.min(200, Math.max(50, Math.round(bpm))), chords, melody };
}

/* ───────── Standard MIDI File (type 1: chords + melody) ───────── */

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

function track(events: { tick: number; data: number[] }[]): number[] {
  events.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  const len = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}

/** Close, mid-register voicing for the accompaniment track. */
export function padVoicing(symbol: string): number[] {
  const info = chordInfo(symbol);
  const bass = 36 + chroma(info.bass || info.root);
  const upper = info.notes.map((n) => 48 + chroma(n)).map((m) => (m < 52 ? m + 12 : m));
  return [bass, ...upper.sort((a, b) => a - b)];
}

export function songToMidi(song: Song): Uint8Array {
  const PPQ = 480;
  const tempo = Math.round(60_000_000 / song.bpm);
  const meta = track([
    { tick: 0, data: [0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
    { tick: 0, data: [0xff, 0x58, 4, 4, 2, 24, 8] },
  ]);
  const chordEvents: { tick: number; data: number[] }[] = [{ tick: 0, data: [0xc0, 0] }];
  song.chords.forEach((c, i) => {
    const on = i * BEATS_PER_BAR * PPQ;
    const off = on + BEATS_PER_BAR * PPQ - 10;
    for (const m of padVoicing(c)) {
      chordEvents.push({ tick: on, data: [0x90, m, 70] }, { tick: off, data: [0x80, m, 0] });
    }
  });
  const melodyEvents: { tick: number; data: number[] }[] = [{ tick: 0, data: [0xc1, 0] }];
  noteStarts(song.melody).forEach((t, i) => {
    const n = song.melody[i];
    if (n.midi === null) return;
    const on = Math.round(t * PPQ);
    const off = Math.round((t + n.dur) * PPQ) - 10;
    melodyEvents.push({ tick: on, data: [0x91, n.midi, 96] }, { tick: off, data: [0x81, n.midi, 0] });
  });
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...header, ...meta, ...track(chordEvents), ...track(melodyEvents)]);
}

/** A safe four-bar progression for "추천 4마디": I–vi–IV–V, or i–bVI–bIII–bVII in minor. */
export function starterChords(key: string): string[] {
  const nums = parseKey(key).minor ? ['i', 'bVI', 'bIII', 'bVII'] : ['I', 'vi', 'IV', 'V'];
  return nums.map((n) => romanToChord(n, key));
}

/** How a move between two chords feels, for the role strip between bars. */
export function flowNote(a: string, b: string, key: string): { label: string; smooth: boolean } {
  const fa = chordFn(a, key);
  const fb = chordFn(b, key);
  if (a === b) return { label: '머무름', smooth: true };
  if (fa === 'D' && fb === 'T') return { label: '해결', smooth: true };
  if (fa === 'D' && fb === 'S') return { label: '거꾸로', smooth: false };
  if (fb === 'D') return { label: '긴장 쌓기', smooth: true };
  if (fb === 'S') return { label: '펼치기', smooth: true };
  return { label: '쉬어가기', smooth: true };
}
