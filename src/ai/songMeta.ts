import { Interval, Note } from 'tonal';
import { GENRES, GenreId } from '../data/progressions';
import { RHYTHM_BY_ID, RHYTHMS } from '../data/rhythms';
import { estimateKeyFromChords } from '../theory/key';
import { MAJOR_KEYS, MINOR_KEYS, parseKey } from '../theory/keys';

/**
 * Song details looked up for the add/edit form. Everything here is a
 * suggestion: the form shows it, explains it and lets the user correct it.
 */
export interface SongMeta {
  genre: GenreId;
  subtype?: string;
  /** key of the original recording, spelled like the pickers ("F#m", "Eb") */
  key?: string;
  bpm?: number;
  timeSignature: '4/4' | '3/4' | '6/8' | '12/8';
  rhythm: string;
  /** how long chords usually last in this song, if known */
  beatsPerChord?: 2 | 4 | 8;
  confidence: 'high' | 'medium' | 'low';
  /** short Korean explanation for the user */
  note: string;
  sources: { title: string; url: string }[];
}

export interface LookupInput {
  title: string;
  artist: string;
  /** chord symbols the user already pasted, if any */
  chords: string[];
}

const TIME_SIGS = ['4/4', '3/4', '6/8', '12/8'] as const;

/** Builds the request. Claude answers with one JSON object at the end. */
export function buildLookupPrompt(input: LookupInput, canSearch: boolean): string {
  const genres = GENRES.map((g) => `- ${g.id}: ${g.name}${g.subtypes ? ` (subtypes: ${g.subtypes.map((s) => `${s.id}=${s.name}`).join(', ')})` : ''}`).join('\n');
  const rhythms = RHYTHMS.map((r) => `- ${r.id}: ${r.name} — ${r.description}`).join('\n');
  const chords = input.chords.length ? input.chords.slice(0, 64).join(' ') : '(none yet)';
  return `I am adding a song to a piano-accompaniment practice app and need its musical details so the app's backing track lines up with the original recording.

Song title: ${input.title}
Artist: ${input.artist || '(unknown)'}
Chords the user pasted from a chord sheet (may be transposed or simplified): ${chords}

${
  canSearch
    ? 'Search the web for this exact song (BPM/key databases such as songbpm, tunebat, getsongbpm, musicstax, and Korean sources for Korean songs). If the sources disagree, prefer the value most sources agree on. Do not guess the song identity: if you cannot find this exact song, say so in "note" and set confidence to "low".'
    : 'You cannot browse, so answer from what you know about this exact song. If you do not recognise it, estimate from the chords and set confidence to "low".'
}

Report:
- genre: one id from this list (pick the closest):
${genres}
- subtype: a subtype id when the genre has subtypes, otherwise null
- key: the key of the original recording, like "C", "Eb", "F#m", "Bbm" (null if unknown)
- bpm: the tempo of the original recording as an integer. Use the tempo a pianist would count in quarter notes; for a ballad do not double it. For 6/8 or 12/8 songs give the dotted-quarter pulse. (null if unknown)
- timeSignature: one of "4/4", "3/4", "6/8", "12/8"
- rhythm: the accompaniment pattern id from this list that best fits the recording's feel:
${rhythms}
- beatsPerChord: how long chords usually last in this song when counted in quarter-note beats: 2, 4 or 8 (null if unknown)
- confidence: "high", "medium" or "low"
- note: one or two short sentences in Korean for the user (e.g. where the BPM came from, whether the pasted chords are in a different key than the recording, anything to double-check)
- sources: up to 3 {"title", "url"} objects for the pages you used (empty array if none)

Finish your answer with only this JSON object, no code fence:
{"genre": "...", "subtype": null, "key": "...", "bpm": 0, "timeSignature": "4/4", "rhythm": "...", "beatsPerChord": null, "confidence": "...", "note": "...", "sources": []}`;
}

/** Pulls the last top-level JSON object out of an answer. */
export function extractJson(text: string): Record<string, unknown> | null {
  const clean = text.replace(/```(?:json)?/g, '');
  for (let end = clean.lastIndexOf('}'); end >= 0; end = clean.lastIndexOf('}', end - 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = end; i >= 0; i--) {
      const ch = clean[i];
      if (ch === '"' && clean[i - 1] !== '\\') inStr = !inStr;
      if (inStr) continue;
      if (ch === '}') depth++;
      else if (ch === '{' && --depth === 0) {
        try {
          const v = JSON.parse(clean.slice(i, end + 1));
          if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch {
          /* not JSON — try an earlier brace */
        }
        break;
      }
    }
  }
  return null;
}

/** Spells any key name the way the pickers do ("A minor" → "Am", "Gb" → "F#", "D#m" → "Ebm"). */
export function normalizeKeyName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().replace('♯', '#').replace('♭', 'b');
  const m = s.match(/^([A-Ga-g])([#b]?)\s*(.*)$/);
  if (!m) return undefined;
  const rest = m[3].toLowerCase();
  const minor = /^(m|min|minor|moll|단조)\b/.test(rest) || rest === 'm' || /^-/.test(rest);
  const chroma = Note.chroma(m[1].toUpperCase() + m[2]);
  if (chroma === undefined) return undefined;
  const list = minor ? MINOR_KEYS : MAJOR_KEYS;
  return list.find((k) => Note.chroma(parseKey(k).tonic) === chroma);
}

/** Accompaniment pattern that suits a genre and tempo when none was given. */
export function suggestRhythm(genre: GenreId, bpm: number, timeSignature = '4/4', subtype?: string): string {
  if (timeSignature === '6/8' || timeSignature === '12/8') return 'slowjam';
  switch (genre) {
    case 'jazz':
      return bpm < 100 ? 'jazz-ballad' : 'charleston';
    case 'bossa':
      return 'bossa';
    case 'hiphop':
      return bpm >= 125 ? 'trap' : bpm < 82 ? 'lofi' : 'boombap';
    case 'rnb': {
      const bySub: Record<string, string> = { soul: 'motown', njs: 'newjack', slowjam: 'slowjam', neosoul: 'neosoul', gospel: 'gospel', alt: 'neosoul' };
      return (subtype && bySub[subtype]) || (bpm < 80 ? 'slowjam' : 'neosoul');
    }
    case 'kpop':
      return bpm < 95 ? 'kpop-ballad' : 'kpop-332';
    default:
      return bpm < 90 ? 'ballad-arp' : 'pop8';
  }
}

/** True when two keys share a key signature (C and Am). */
export function relativeKeys(a: string, b: string): boolean {
  const pcs = (k: string) => {
    const { tonic, minor } = parseKey(k);
    const t = Note.chroma(tonic) ?? 0;
    return (minor ? t + 3 : t) % 12;
  };
  return pcs(a) === pcs(b);
}

/** Validates whatever came back and fills the gaps with app defaults. */
export function normalizeMeta(raw: Record<string, unknown>, fallbackGenre: GenreId = 'pop'): SongMeta {
  const genre = GENRES.some((g) => g.id === raw.genre) ? (raw.genre as GenreId) : fallbackGenre;
  const g = GENRES.find((x) => x.id === genre)!;
  const subtype = g.subtypes?.some((s) => s.id === raw.subtype) ? (raw.subtype as string) : undefined;
  let bpm = typeof raw.bpm === 'number' ? raw.bpm : typeof raw.bpm === 'string' ? parseFloat(raw.bpm) : NaN;
  bpm = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : NaN;
  // the app plays 40–220; halve/double obvious double-time or half-time reads
  if (bpm > 220) bpm = Math.round(bpm / 2);
  if (bpm > 0 && bpm < 40) bpm *= 2;
  const timeSignature = (TIME_SIGS as readonly string[]).includes(raw.timeSignature as string) ? (raw.timeSignature as SongMeta['timeSignature']) : '4/4';
  const rhythm =
    typeof raw.rhythm === 'string' && RHYTHM_BY_ID[raw.rhythm] && !(timeSignature !== '4/4' && timeSignature !== '3/4' && raw.rhythm !== 'slowjam')
      ? raw.rhythm
      : suggestRhythm(genre, bpm || 90, timeSignature, subtype);
  const bpc = Number(raw.beatsPerChord);
  const sources = Array.isArray(raw.sources)
    ? raw.sources
        .filter((s): s is { title?: unknown; url: string } => !!s && typeof s === 'object' && typeof (s as { url?: unknown }).url === 'string' && /^https?:\/\//.test((s as { url: string }).url))
        .slice(0, 3)
        .map((s) => ({ title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : new URL(s.url).hostname, url: s.url }))
    : [];
  return {
    genre,
    subtype,
    key: normalizeKeyName(raw.key),
    bpm: bpm || undefined,
    timeSignature,
    rhythm,
    beatsPerChord: bpc === 2 || bpc === 4 || bpc === 8 ? bpc : undefined,
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low',
    note: typeof raw.note === 'string' ? raw.note.trim() : '',
    sources,
  };
}

export type KeyAdvice =
  | { kind: 'none' }
  /** use this key for the song */
  | { kind: 'use'; key: string }
  /** the pasted chords are in another key than the recording */
  | { kind: 'transposed'; chordKey: string; recordingKey: string };

/**
 * The song's key must describe the chords the app plays, so the looked-up
 * recording key is only taken as-is when the chords agree with it (or are
 * its relative major/minor). Otherwise the chords were written in another
 * key, and the user can choose to move them to the recording's key.
 */
export function keyAdvice(recordingKey: string | undefined, chords: string[]): KeyAdvice {
  const chordKey = chords.length ? estimateKeyFromChords(chords, Infinity, 1)[0]?.key : undefined;
  if (!recordingKey) return chordKey ? { kind: 'use', key: chordKey } : { kind: 'none' };
  if (!chordKey || relativeKeys(chordKey, recordingKey)) return { kind: 'use', key: recordingKey };
  // same tonic, other mode: the chords decide
  if (Note.chroma(parseKey(chordKey).tonic) === Note.chroma(parseKey(recordingKey).tonic)) return { kind: 'use', key: chordKey };
  return { kind: 'transposed', chordKey, recordingKey };
}

/** Major-key centre of a key's signature (Am → C). */
function signatureCentre(key: string): number {
  const { tonic, minor } = parseKey(key);
  return ((Note.chroma(tonic) ?? 0) + (minor ? 3 : 0)) % 12;
}

/** Shortest interval that moves music written in `from` to `to` (−5…+6 semitones). */
export function keyShift(from: string, to: string): string {
  let d = (signatureCentre(to) - signatureCentre(from) + 12) % 12;
  if (d > 6) d -= 12;
  return Interval.fromSemitones(d) || '1P';
}

export type LookupErrorCode = 'no_key' | 'bad_key' | 'rate_limited' | 'network' | 'refused' | 'no_answer' | 'cancelled' | 'unavailable';

export class LookupError extends Error {
  constructor(
    message: string,
    readonly code: LookupErrorCode,
  ) {
    super(message);
  }
}

export interface LookupResult extends SongMeta {
  via: 'web' | 'knowledge';
}
