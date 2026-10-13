import { describe, expect, it } from 'vitest';
import { tapBpm } from '../components/TapTempo';
import { respaceChords, transposeBarText, uniformChordBeats } from '../theory/sheet';
import { buildLookupPrompt, extractJson, keyAdvice, keyShift, normalizeKeyName, normalizeMeta, relativeKeys, suggestRhythm } from './songMeta';

describe('song lookup answers', () => {
  it('finds the trailing JSON object in an answer', () => {
    const text = 'I found it on {tunebat}.\nSome text {"a": 1}\n{"genre": "kpop", "note": "a } in text", "sources": [{"title": "x", "url": "https://x.io"}]}';
    expect(extractJson(text)).toEqual({ genre: 'kpop', note: 'a } in text', sources: [{ title: 'x', url: 'https://x.io' }] });
    expect(extractJson('```json\n{"bpm": 92}\n```')).toEqual({ bpm: 92 });
    expect(extractJson('no json here')).toBeNull();
  });

  it('spells keys the way the pickers do', () => {
    expect(normalizeKeyName('A minor')).toBe('Am');
    expect(normalizeKeyName('Gb major')).toBe('F#');
    expect(normalizeKeyName('D#m')).toBe('Ebm');
    expect(normalizeKeyName('E♭')).toBe('Eb');
    expect(normalizeKeyName('f# min')).toBe('F#m');
    expect(normalizeKeyName('C')).toBe('C');
    expect(normalizeKeyName('H')).toBeUndefined();
    expect(normalizeKeyName(null)).toBeUndefined();
  });

  it('validates and completes the metadata', () => {
    const m = normalizeMeta({ genre: 'rnb', subtype: 'slowjam', key: 'Bb major', bpm: '68', timeSignature: '12/8', rhythm: 'pop8', beatsPerChord: 4, confidence: 'high', note: ' 메모 ', sources: [{ url: 'javascript:alert(1)' }, { url: 'https://songbpm.com/x' }] });
    expect(m).toMatchObject({ genre: 'rnb', subtype: 'slowjam', key: 'Bb', bpm: 68, timeSignature: '12/8', rhythm: 'slowjam', beatsPerChord: 4, confidence: 'high', note: '메모' });
    expect(m.sources).toEqual([{ title: 'songbpm.com', url: 'https://songbpm.com/x' }]);

    const junk = normalizeMeta({ genre: 'metal', bpm: 300, rhythm: 'nope', confidence: 'sure' }, 'kpop');
    expect(junk.genre).toBe('kpop');
    expect(junk.bpm).toBe(150);
    expect(junk.rhythm).toBe('kpop-332');
    expect(junk.confidence).toBe('low');
    expect(junk.key).toBeUndefined();
    expect(junk.beatsPerChord).toBeUndefined();
  });

  it('picks a rhythm from genre and tempo', () => {
    expect(suggestRhythm('kpop', 70)).toBe('kpop-ballad');
    expect(suggestRhythm('kpop', 120)).toBe('kpop-332');
    expect(suggestRhythm('pop', 72)).toBe('ballad-arp');
    expect(suggestRhythm('jazz', 140)).toBe('charleston');
    expect(suggestRhythm('rnb', 100, '4/4', 'njs')).toBe('newjack');
    expect(suggestRhythm('pop', 60, '6/8')).toBe('slowjam');
    expect(suggestRhythm('hiphop', 140)).toBe('trap');
  });

  it('keeps the key consistent with the chords', () => {
    const inC = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C'];
    expect(relativeKeys('C', 'Am')).toBe(true);
    expect(relativeKeys('C', 'Em')).toBe(false);
    // recording key agrees (or is the relative minor): take it
    expect(keyAdvice('C', inC)).toEqual({ kind: 'use', key: 'C' });
    expect(keyAdvice('Am', inC)).toEqual({ kind: 'use', key: 'Am' });
    // chords were written in another key
    expect(keyAdvice('Eb', inC)).toEqual({ kind: 'transposed', chordKey: 'C', recordingKey: 'Eb' });
    // nothing known
    expect(keyAdvice(undefined, [])).toEqual({ kind: 'none' });
    expect(keyAdvice('F#m', [])).toEqual({ kind: 'use', key: 'F#m' });
  });

  it('moves chords to the recording key by the shortest way', () => {
    expect(keyShift('C', 'Eb')).toBe('3m');
    expect(keyShift('C', 'A')).toBe('-3m');
    expect(keyShift('G', 'F#m')).toBe('2M');
    expect(transposeBarText('C G:2 Am/E:2 | F', '3m')).toBe('Eb Bb:2 Cm/G:2 | Ab');
  });

  it('mentions the song, chords and every rhythm in the prompt', () => {
    const p = buildLookupPrompt({ title: '밤편지', artist: '아이유', chords: ['C', 'G'] }, true);
    expect(p).toContain('밤편지');
    expect(p).toContain('C G');
    expect(p).toContain('kpop-ballad');
    expect(p).toContain('Search the web');
    expect(buildLookupPrompt({ title: 'x', artist: '', chords: [] }, false)).toContain('cannot browse');
  });
});

describe('chord lengths and tapping', () => {
  it('re-spaces a section to one length per chord', () => {
    expect(respaceChords('C G | Am F', 4)).toBe('C | G | Am | F');
    expect(respaceChords('C | G | Am | F', 2)).toBe('C G | Am F');
    expect(respaceChords('C G | Am', 8)).toBe('C:8 | G:8 | Am:8');
    expect(uniformChordBeats('C:8 | G:8')).toBe(8);
    expect(uniformChordBeats('C G | Am')).toBeUndefined();
  });

  it('reads the tempo from taps', () => {
    expect(tapBpm([0])).toBeUndefined();
    expect(tapBpm([0, 500, 1000, 1500])).toBe(120);
    expect(tapBpm([0, 1000, 2000])).toBe(60);
  });
});
