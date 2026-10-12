import { describe, expect, it } from 'vitest';
import { getRhythm } from '../data/rhythms';
import { buildScore, splitDuration } from '../notation/score';
import { buildArrangement } from './arrange';
import { detectFromChroma, detectFromMidi } from './detect';
import { estimateKey, estimateKeyFromChords } from './key';
import { intervalBetweenKeys, movableDo, transposeChord } from './keys';
import { prettyChord, solfege } from './notes';
import { chordToRoman, harmonicFunction, parseBars, progressionToChords, romanToChord, secondaryLabel } from './roman';
import { suggestNext } from './suggest';
import { noteRole, voiceChord } from './voicing';

describe('roman numerals', () => {
  it('converts numerals to chords', () => {
    expect(romanToChord('I', 'C')).toBe('C');
    expect(romanToChord('ii7', 'C')).toBe('Dm7');
    expect(romanToChord('V7', 'F')).toBe('C7');
    expect(romanToChord('vii°', 'C')).toBe('Bdim');
    expect(romanToChord('viiø7', 'C')).toBe('Bm7b5');
    expect(romanToChord('bVIImaj7', 'C')).toBe('Bbmaj7');
    expect(romanToChord('bIII', 'Am')).toBe('C');
    expect(romanToChord('i7', 'Am')).toBe('Am7');
    expect(romanToChord('iiø7', 'Am')).toBe('Bm7b5');
    expect(romanToChord('#iv°7', 'F')).toBe('Bdim7');
    expect(romanToChord('V7/vi', 'C')).toBe('E7');
    expect(romanToChord('V7/V', 'G')).toBe('A7');
    expect(romanToChord('V/7', 'C')).toBe('G/B');
    expect(romanToChord('I/3', 'D')).toBe('D/F#');
    expect(romanToChord('bII7', 'Eb')).toBe('E7');
    expect(romanToChord('IVmaj7', 'Eb')).toBe('Abmaj7');
  });

  it('analyses chords as numerals', () => {
    expect(chordToRoman('Dm7', 'C')).toBe('ii7');
    expect(chordToRoman('G7', 'C')).toBe('V7');
    expect(chordToRoman('Bbmaj7', 'C')).toBe('bVIImaj7');
    expect(chordToRoman('Bm7b5', 'Am')).toBe('iiø7');
    expect(chordToRoman('E/G#', 'A')).toBe('V/7');
    expect(chordToRoman('Bdim', 'C')).toBe('vii°');
    expect(chordToRoman('C', 'Am')).toBe('bIII');
    expect(secondaryLabel('E7', 'C')).toBe('V7/vi');
    expect(secondaryLabel('G7', 'C')).toBeUndefined();
    expect(harmonicFunction('F', 'C').code).toBe('S');
    expect(harmonicFunction('Am7', 'C').code).toBe('T');
    expect(harmonicFunction('G7', 'C').code).toBe('D');
    expect(harmonicFunction('Fm', 'C').code).toBe('B');
    expect(harmonicFunction('Bb', 'C').code).toBe('B');
    expect(harmonicFunction('E7', 'Am').code).toBe('D');
    expect(harmonicFunction('Dm7b5', 'Cm').code).toBe('S');
  });

  it('round-trips progressions', () => {
    const chords = progressionToChords('I V | vi IV', 'G');
    expect(chords.map((c) => c.symbol)).toEqual(['G', 'D', 'Em', 'C']);
    expect(chords.map((c) => c.beats)).toEqual([2, 2, 2, 2]);
    expect(parseBars('C:3 G:1 | F').map((c) => c.beats)).toEqual([3, 1, 4]);
  });
});

describe('notes & keys', () => {
  it('names notes in solfege', () => {
    expect(solfege('C4')).toBe('도');
    expect(solfege('Bb3')).toBe('시♭');
    expect(solfege('F#5')).toBe('파♯');
    expect(prettyChord('Bbm7b5/F')).toBe('B♭m7♭5/F');
  });
  it('names notes in movable do', () => {
    expect(movableDo('C4', 'C')).toBe('도');
    expect(movableDo('A4', 'F')).toBe('미');
    expect(movableDo('F#4', 'D')).toBe('미');
    expect(movableDo('Bb4', 'C')).toBe('시♭');
    expect(movableDo('F#4', 'C')).toBe('파♯');
    expect(movableDo('Eb4', 'Eb')).toBe('도');
    expect(movableDo('A3', 'Am')).toBe('라');
    expect(movableDo('G#3', 'Am')).toBe('솔♯');
    expect(movableDo('G4', 'Gm')).toBe('라');
    expect(movableDo('Ab4', 'Eb')).toBe('파');
  });
  it('transposes chords', () => {
    expect(transposeChord('E/G#', intervalBetweenKeys('A', 'C'))).toBe('G/B');
    expect(transposeChord('Bm7b5', intervalBetweenKeys('Am', 'Gm'))).toBe('Am7b5');
    expect(transposeChord('C', intervalBetweenKeys('C', 'Eb'))).toBe('Eb');
  });
});

describe('voicing', () => {
  it('voices chords in a playable range', () => {
    const v = voiceChord('Cmaj7');
    expect(v.rh).toHaveLength(4);
    expect(v.bass).toMatch(/^C[23]$/);
    const big = voiceChord('C13');
    expect(big.rh.length).toBeLessThanOrEqual(4);
  });
  it('labels note roles', () => {
    expect(noteRole('E4', 'Cmaj7')).toBe('장3음');
    expect(noteRole('B4', 'Cmaj7')).toBe('장7음');
    expect(noteRole('C4', 'Cmaj7')).toBe('근음');
    expect(noteRole('Gb4', 'Cm7b5')).toBe('♭5음');
    expect(noteRole('D5', 'C9')).toBe('9음');
  });
});

describe('detection', () => {
  it('detects chords from MIDI notes', () => {
    expect(detectFromMidi([60, 64, 67])[0].symbol).toBe('C');
    expect(detectFromMidi([57, 60, 64, 67])[0].symbol).toBe('Am7');
    expect(detectFromMidi([52, 60, 67])[0].symbol).toBe('C/E');
    expect(detectFromMidi([62, 65, 69, 72])[0].symbol).toBe('Dm7');
  });
  it('detects chords from noisy chroma', () => {
    const c = new Array(12).fill(0.05);
    c[7] = 1;
    c[11] = 0.8;
    c[2] = 0.7;
    c[5] = 0.6;
    expect(detectFromChroma(c, 7)[0].symbol).toBe('G7');
  });
  it('estimates keys', () => {
    const h = new Array(12).fill(0);
    for (const pc of [0, 2, 4, 5, 7, 9, 11]) h[pc] = 1;
    h[0] = 2;
    h[7] = 1.5;
    expect(estimateKey(h)[0].key).toBe('C');
    expect(estimateKeyFromChords(['Dm7', 'G7'])[0].key).toBe('C');
    expect(estimateKeyFromChords(['Dm7', 'G7', 'Cmaj7'])[0].key).toBe('C');
    expect(estimateKeyFromChords(['Am', 'F', 'C', 'G'])[0].key).toMatch(/^(C|Am)$/);
    expect(estimateKeyFromChords(['Bm7b5', 'E7', 'Am7'])[0].key).toBe('Am');
    expect(estimateKeyFromChords(['Cm7', 'F7', 'Bbmaj7', 'Ebmaj7'])[0].key).toBe('Bb');
  });
});

describe('suggestions', () => {
  it('suggests resolutions', () => {
    expect(suggestNext('G7', 'C')[0].symbol).toBe('C');
    expect(suggestNext('Dm7', 'C', { style: 'jazz' })[0].symbol).toBe('G7');
    expect(suggestNext('E7', 'C').map((s) => s.symbol)).toContain('Am');
  });
});

describe('arrangement & score', () => {
  it('re-strikes held parts at chord changes', () => {
    const arr = buildArrangement(parseBars('C G | Am'), getRhythm('whole'));
    const lh = arr.events.filter((e) => e.hand === 'lh');
    expect(lh.map((e) => [e.t, e.d])).toEqual([
      [0, 2],
      [2, 2],
      [4, 4],
    ]);
  });
  it('handles anticipations into the next chord', () => {
    const arr = buildArrangement(parseBars('C | F'), getRhythm('citypop'));
    const pushed = arr.events.find((e) => e.hand === 'rh' && e.t === 3.5)!;
    expect(pushed.chord).toBe(1);
    const wrap = arr.events.find((e) => e.hand === 'rh' && e.t === 7.5)!;
    expect(wrap.chord).toBe(0);
    expect(wrap.d).toBeCloseTo(0.5);
  });
  it('walks the bass', () => {
    const arr = buildArrangement(parseBars('Dm7 | G7'), getRhythm('charleston'));
    const lh = arr.events.filter((e) => e.hand === 'lh').map((e) => e.notes[0]);
    expect(lh[0]).toMatch(/^D/);
    expect(lh[4]).toMatch(/^G/);
    expect(lh).toHaveLength(8);
  });
  it('builds full bars of notation', () => {
    for (const id of ['pop8', 'bossa', 'citypop', 'kpop-332', 'ballad-arp', 'lofi']) {
      const chords = parseBars('C | Am | F | G');
      const bars = buildScore(buildArrangement(chords, getRhythm(id)), chords);
      expect(bars).toHaveLength(4);
      for (const b of bars) {
        expect(b.rh.reduce((a, i) => a + i.len, 0)).toBe(16);
        expect(b.lh.reduce((a, i) => a + i.len, 0)).toBe(16);
      }
    }
  });
  it('splits durations on beat boundaries', () => {
    expect(splitDuration(0, 16).map((d) => d.dur)).toEqual(['w']);
    expect(splitDuration(2, 4).map((d) => d.dur)).toEqual(['8', '8']);
    expect(splitDuration(0, 6).map((d) => d.dur)).toEqual(['qd']);
    expect(splitDuration(6, 10).map((d) => d.dur)).toEqual(['8', 'h']);
  });
});
