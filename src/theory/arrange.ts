import { Note } from 'tonal';
import type { DrumHit, Part, RhythmPattern } from '../data/rhythms';
import { midiToNote } from './notes';
import type { ChordEvent } from './roman';
import { fifthAbove, octaveAbove, shellVoicing, voiceProgression, Voicing, VoicingMode } from './voicing';

export interface NoteEvent {
  t: number;
  d: number;
  notes: string[];
  hand: 'rh' | 'lh';
  vel: number;
  chord: number;
}

export interface Arrangement {
  events: NoteEvent[];
  drums: DrumHit[];
  total: number;
  starts: number[];
  voicings: Voicing[];
}

const EPS = 1e-6;

function walkNote(v: Voicing, next: Voicing, beat: number, beats: number): string {
  const bassMidi = Note.midi(v.bass) ?? 40;
  const n = Math.max(1, Math.round(beats));
  if (beat === 0) return v.bass;
  if (beat === n - 1) {
    // chromatic approach into the next chord's bass
    let target = Note.midi(next.bass) ?? 40;
    while (target - bassMidi > 6) target -= 12;
    while (bassMidi - target > 6) target += 12;
    const approach = target > bassMidi ? target - 1 : target + 1;
    return midiToNote(approach);
  }
  const tones = v.info.notes.slice(1, 3).map((pc) => {
    let m = Note.midi(pc + '2') ?? 40;
    while (m <= bassMidi) m += 12;
    return pc + (Math.floor(m / 12) - 1);
  });
  return tones[(beat - 1) % Math.max(1, tones.length)] ?? v.bass;
}

function partNotes(part: Part, v: Voicing, next: Voicing, beat: number, beats: number): { notes: string[]; hand: 'rh' | 'lh' } {
  switch (part) {
    case 'chord':
      return { notes: v.rh, hand: 'rh' };
    case 'bass':
      return { notes: [v.bass], hand: 'lh' };
    case 'bass5':
      return { notes: [fifthAbove(v)], hand: 'lh' };
    case 'bass8':
      return { notes: [octaveAbove(v.bass)], hand: 'lh' };
    case 'shell':
      return { notes: shellVoicing(v), hand: 'lh' };
    case 'walk':
      return { notes: [walkNote(v, next, beat, beats)], hand: 'lh' };
    default: {
      const idx = Number(part.slice(3));
      const sorted = [...v.rh].sort((a, b) => (Note.midi(a) ?? 0) - (Note.midi(b) ?? 0));
      return { notes: sorted.length ? [sorted[idx % sorted.length]] : [], hand: 'rh' };
    }
  }
}

/** Expands a progression + rhythm pattern into concrete note events (in beats). */
export function buildArrangement(chords: ChordEvent[], rhythm: RhythmPattern, mode: VoicingMode = 'smooth'): Arrangement {
  const voicings = voiceProgression(chords.map((c) => c.symbol), mode);
  const starts: number[] = [];
  let total = 0;
  for (const c of chords) {
    starts.push(total);
    total += c.beats;
  }
  const events: NoteEvent[] = [];
  const drums: DrumHit[] = [];
  if (!chords.length) return { events, drums, total, starts, voicings };

  const chordAt = (g: number) => {
    const x = ((g % total) + total) % total;
    for (let k = chords.length - 1; k >= 0; k--) if (starts[k] <= x + EPS) return k;
    return 0;
  };
  const endOf = (k: number) => starts[k] + chords[k].beats;

  for (let cyc = 0; cyc < total - EPS; cyc += rhythm.length) {
    for (const ev of rhythm.events) {
      const g = cyc + ev.t;
      if (g >= total - EPS) continue;
      let k = chordAt(ev.push ? g + 0.5 : g);
      const pushWraps = !!ev.push && g + 0.5 >= total - EPS; // anticipates the loop's first chord
      let start = g;
      let remaining = ev.d;
      let first = true;
      while (remaining > EPS && start < total - EPS) {
        const regionEnd = first && pushWraps ? total : endOf(k);
        const len = Math.min(remaining, regionEnd - start, total - start);
        if (len <= EPS) break;
        const beatInChord = Math.max(0, Math.round(start - starts[k]));
        const { notes, hand } = partNotes(ev.part, voicings[k], voicings[(k + 1) % chords.length], beatInChord, chords[k].beats);
        if (notes.length) events.push({ t: start, d: len, notes, hand, vel: ev.vel ?? 0.6, chord: k });
        remaining -= len;
        start += len;
        first = false;
        if (start < total - EPS) k = chordAt(start);
      }
    }
    for (const h of rhythm.drums ?? []) {
      if (cyc + h.t < total - EPS) drums.push({ ...h, t: cyc + h.t });
    }
  }
  events.sort((a, b) => a.t - b.t);
  drums.sort((a, b) => a.t - b.t);
  return { events, drums, total, starts, voicings };
}

/** Moves off-beat 8ths (or 16ths) later to create swing. */
export function swingTime(t: number, rhythm: RhythmPattern): number {
  const s = rhythm.swing ?? 0;
  if (!s) return t;
  const unit = rhythm.swing16 ? 0.5 : 1;
  const frac = ((t % unit) + unit) % unit;
  if (Math.abs(frac - unit / 2) < 1e-4) return t + (s * unit) / 6;
  return t;
}
