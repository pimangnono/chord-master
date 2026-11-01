import { describe, expect, it } from 'vitest';
import {
  beatsLeftInBar,
  decodeSong,
  DEFAULT_SONG,
  encodeSong,
  endingChords,
  HIGH,
  LOW,
  MOODS,
  moodSong,
  noteKind,
  Song,
  songToMidi,
  suggestChords,
  suggestNotes,
  transposeSong,
} from './melody';

const song = (melody: Song['melody'] = []): Song => ({ key: 'C', bpm: 100, chords: ['C', 'G', 'Am', 'F'], melody });

describe('melody maker', () => {
  it('every mood builds a playable song', () => {
    for (const m of MOODS) {
      const s = moodSong(m);
      expect(s.chords).toHaveLength(m.numerals.length);
      expect(s.chords.every((c) => /^[A-G]/.test(c))).toBe(true);
    }
  });

  it('suggests distinct in-range notes, chord tones first on a downbeat', () => {
    const ideas = suggestNotes(song(), { seed: 3 });
    expect(ideas).toHaveLength(4);
    expect(new Set(ideas.map((i) => i.midi % 12)).size).toBe(4);
    for (const i of ideas) expect(i.midi >= LOW && i.midi <= HIGH).toBe(true);
    expect(noteKind(ideas[0].midi, 'C', 'C')).toBe('chord');
  });

  it('prefers stepwise motion and resolves the leading tone', () => {
    const s = song([
      { midi: 67, dur: 4 },
      { midi: 67, dur: 4 },
      { midi: 69, dur: 4 },
      { midi: 71, dur: 2 },
    ]);
    const ideas = suggestNotes(s, { seed: 1, count: 1 });
    expect(ideas[0].midi).toBe(72);
  });

  it('stops suggesting once every bar is full', () => {
    expect(suggestNotes(song([{ midi: 60, dur: 4 }, { midi: 60, dur: 4 }, { midi: 60, dur: 4 }, { midi: 60, dur: 4 }]))).toEqual([]);
  });

  it('counts the beats left in a bar', () => {
    expect(beatsLeftInBar(0)).toBe(4);
    expect(beatsLeftInBar(5.5)).toBe(2.5);
  });

  it('chord ideas avoid the current chord and repeat roots', () => {
    const ideas = suggestChords(['C', 'G', 'Am', 'F'], 3, 'C');
    expect(ideas.map((i) => i.symbol)).not.toContain('F');
    expect(new Set(ideas.map((i) => i.symbol.replace(/[^A-G#b].*$/, ''))).size).toBe(ideas.length);
    expect(endingChords('C')).toEqual({ loop: 'G7', close: 'C' });
    expect(endingChords('Am').close).toBe('Am');
  });

  it('round-trips through a share link and rejects junk', () => {
    const s = song([
      { midi: 64, dur: 1 },
      { midi: null, dur: 0.5 },
      { midi: 67, dur: 1.5 },
      { midi: 72, dur: 4 },
    ]);
    expect(decodeSong(encodeSong(s))).toEqual(s);
    expect(decodeSong(encodeSong({ ...s, key: 'F#m', chords: ['F#m', 'C#7'] , melody: [] }))?.chords).toEqual(['F#m', 'C#7']);
    expect(decodeSong('nope')).toBeNull();
    expect(decodeSong('1|C|100|C|60w,60w')).toBeNull(); // longer than the bars
    expect(decodeSong('1|C|100|C|10q')).toBeNull(); // out of range
  });

  it('transposes chords and keeps the melody on the keyboard', () => {
    const t = transposeSong(song([{ midi: 83, dur: 1 }]), 'D');
    expect(t.chords).toEqual(['D', 'A', 'Bm', 'G']);
    expect(t.melody[0].midi).toBe(73);
  });

  it('writes a valid three-track MIDI file', () => {
    const bytes = songToMidi(song([{ midi: 60, dur: 1 }]));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
    expect(bytes[11]).toBe(3);
    const text = String.fromCharCode(...bytes);
    expect(text.split('MTrk')).toHaveLength(4);
  });

  it('starts from a default song', () => {
    expect(DEFAULT_SONG.melody).toEqual([]);
  });
});

import { flowNote, starterChords } from './melody';

describe('chord helpers', () => {
  it('offers a starter progression in major and minor', () => {
    expect(starterChords('C')).toEqual(['C', 'Am', 'F', 'G']);
    expect(starterChords('Am')).toEqual(['Am', 'F', 'C', 'G']);
  });

  it('labels chord moves', () => {
    expect(flowNote('G7', 'C', 'C')).toEqual({ label: '해결', smooth: true });
    expect(flowNote('G', 'F', 'C').smooth).toBe(false);
    expect(flowNote('C', 'F', 'C').label).toBe('펼치기');
  });
});
