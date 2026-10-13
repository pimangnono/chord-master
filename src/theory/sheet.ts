import { Chord, Interval } from 'tonal';
import { estimateKeyFromChords } from './key';
import { transposeChord } from './keys';
import { splitSlash } from './notes';
import { ChordEvent, chordsToBars, parseBars } from './roman';

export interface SheetLine {
  chords: string[];
  /** a lyric line sits under these chords (vs. a bare chord line, e.g. an interlude) */
  lyric: boolean;
}

export interface SheetSection {
  name: string;
  chords: string[];
  /** the chords line by line, as laid out on the sheet */
  lines: SheetLine[];
}

export interface ParsedSheet {
  sections: SheetSection[];
  /** tokens on chord lines that could not be read as chords */
  unknown: string[];
  capo: number;
  key?: string;
  /** key written on the sheet itself ("Key: C", or a lone chord above the first heading) */
  declaredKey?: string;
  chordCount: number;
}

export interface ParseOptions {
  /** keep sections whose chords repeat an earlier one (the whole song in order) */
  keepRepeats?: boolean;
}

const KEY_LINE = /^\s*(?:original\s+)?(?:key|키|조성)\s*[:=]?\s*([A-G][#b♯♭]?m?)\s*$/i;

const SECTION_NAMES: [RegExp, string][] = [
  [/^pre[\s-]?chorus/i, '프리코러스'],
  [/^chorus|^refrain|^hook/i, '후렴'],
  [/^verse/i, '벌스'],
  [/^bridge/i, '브릿지'],
  [/^intro/i, '인트로'],
  [/^outro|^ending|^coda/i, '아웃트로'],
  [/^interlude|^instrumental|^break/i, '간주'],
  [/^solo/i, '솔로'],
  [/^tag/i, '태그'],
];
const KOREAN_SECTION = /^(벌스|후렴|브릿지|인트로|아웃트로|간주|프리코러스|코러스|훅|도입부|\d+절|절)/;

/** "[Verse 2]", "Chorus:", "(브릿지)" → section name, else undefined. */
export function sectionName(line: string): string | undefined {
  const m = line.trim().match(/^[[(]?\s*([^\])]+?)\s*[\])]?\s*:?\s*$/);
  if (!m) return undefined;
  const raw = m[1].trim();
  if (raw.length > 24) return undefined;
  for (const [re, ko] of SECTION_NAMES) {
    if (re.test(raw)) {
      const num = raw.match(/\d+/);
      return num ? `${ko} ${num[0]}` : ko;
    }
  }
  if (KOREAN_SECTION.test(raw)) return raw;
  return undefined;
}

/** Normalises common chord-sheet spellings to symbols the app understands, or undefined. */
export function normalizeChord(token: string): string | undefined {
  let t = token
    .trim()
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/[()]/g, '')
    .replace(/\*+$/, '');
  const m = t.match(/^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/);
  if (!m) return undefined;
  let [, root, suffix, bass] = m;
  suffix = suffix
    .replace(/^min(?!or)/, 'm')
    .replace(/^-(?=\d|$)/, 'm')
    .replace(/^Maj/, 'maj')
    .replace(/^Δ7?/, 'maj7')
    .replace(/^°7/, 'dim7')
    .replace(/^°/, 'dim')
    .replace(/^ø7?/, 'm7b5')
    .replace(/^\+$/, 'aug')
    .replace(/^maj$/, '')
    .replace(/sus$/, 'sus4')
    .replace(/add2$/, 'add9');
  const symbol = root + suffix;
  if (Chord.get(symbol).empty) return undefined;
  return bass ? `${symbol}/${bass}` : symbol;
}

const IGNORABLE = /^(\||\/|-|–|—|\.|N\.?C\.?|x\d+|×\d+|\d+x|\(x?\d+x?\)|%|:\|\|?|\|\|:?)$/i;

/** Chords on a line, or null when the line is lyrics/text. */
function chordsInLine(line: string, unknown: string[]): string[] | null {
  // ChordPro / inline style: "[C]Let it [G]be"
  const bracketed = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  if (bracketed.length && bracketed.every((b) => normalizeChord(b))) return bracketed.map((b) => normalizeChord(b)!);

  const tokens = line
    .replace(/[|]/g, ' | ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  const meaningful = tokens.filter((x) => !IGNORABLE.test(x));
  if (!meaningful.length) return null;
  const chords: string[] = [];
  const bad: string[] = [];
  for (const tok of meaningful) {
    const c = normalizeChord(tok);
    if (c) chords.push(c);
    else bad.push(tok);
  }
  if (!chords.length || chords.length / meaningful.length < 0.6) return null;
  unknown.push(...bad);
  const rep = line.match(/(?:x|×)\s*(\d)|(\d)\s*x\b/i);
  const times = rep ? Number(rep[1] ?? rep[2]) : 1;
  return Array.from({ length: Math.min(times, 8) }, () => chords).flat();
}

/**
 * Pulls the chord progression out of a pasted chord sheet (chords above
 * lyrics, ChordPro, or bare chord lines). Lyrics are discarded.
 */
export function parseChordSheet(text: string, applyCapo = true, opts: ParseOptions = {}): ParsedSheet {
  const unknown: string[] = [];
  const capoMatch = text.match(/capo[^0-9\n]{0,12}(\d{1,2})/i) ?? text.match(/카포[^0-9\n]{0,6}(\d{1,2})/);
  const capo = capoMatch ? Number(capoMatch[1]) : 0;
  const sections: SheetSection[] = [];
  let current: SheetSection = { name: '파트 1', chords: [], lines: [] };
  let declaredKey: string | undefined;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const isChordLine = (l: string) => !sectionName(l) && chordsInLine(l, []) !== null;
  lines.forEach((line, i) => {
    const keyLine = line.match(KEY_LINE);
    if (keyLine) {
      declaredKey ??= normalizeChord(keyLine[1]);
      return;
    }
    const name = sectionName(line);
    if (name && !normalizeChord(line.trim())) {
      if (current.chords.length) sections.push(current);
      current = { name, chords: [], lines: [] };
      return;
    }
    const chords = chordsInLine(line, unknown);
    if (!chords) return;
    // a lone chord above the first heading is the sheet's key, not music
    if (!sections.length && !current.chords.length && chords.length === 1 && line.trim().split(/\s+/).length === 1 && lines[i + 1] && sectionName(lines[i + 1])) {
      declaredKey ??= chords[0];
      return;
    }
    const next = lines[i + 1];
    current.chords.push(...chords);
    current.lines.push({ chords, lyric: !!next && !sectionName(next) && !isChordLine(next) });
  });
  if (current.chords.length) sections.push(current);

  // Same chords under a repeated heading (Verse 2, Chorus again) add nothing to learn —
  // unless the whole song is wanted in order (to play along with the recording).
  const seen = new Set<string>();
  let unique = opts.keepRepeats
    ? sections
    : sections.filter((s) => {
        const sig = s.chords.join(' ');
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      });
  if (capo && applyCapo) {
    const ivl = Interval.fromSemitones(capo);
    const tr = (c: string) => transposeChord(c, ivl);
    unique = unique.map((s) => ({ ...s, chords: s.chords.map(tr), lines: s.lines.map((l) => ({ ...l, chords: l.chords.map(tr) })) }));
    if (declaredKey) declaredKey = transposeChord(declaredKey, ivl);
  }
  const all = unique.flatMap((s) => s.chords);
  const key = declaredKey ?? estimateKeyFromChords(all, Infinity, 1)[0]?.key;
  return { sections: unique, unknown: [...new Set(unknown)], capo, key, declaredKey, chordCount: all.length };
}

/**
 * Lays a section out by the sheet's lines: a lyric line lasts `barsPerLyricLine`
 * bars (more when it carries many chords), a bare chord line one bar per one or
 * two chords. Chords share a line in half-bar steps, the first ones getting
 * the longer share. Only an estimate — the recording decides (see alignChords).
 */
export function linesToBarText(lines: SheetLine[], barsPerLyricLine = 2): string {
  const events: ChordEvent[] = [];
  for (const line of lines) {
    const n = line.chords.length;
    const bars = line.lyric ? Math.max(barsPerLyricLine, Math.ceil(n / 2)) : n <= 2 ? 1 : n;
    const halves = bars * 2;
    const unit = n > halves ? (bars * 4) / n : 2;
    const units = n > halves ? n : halves;
    const base = Math.floor(units / n);
    const extra = units % n;
    line.chords.forEach((c, i) => events.push({ symbol: c, beats: (base + (i < extra ? 1 : 0)) * unit }));
  }
  return chordsToBars(events);
}

/** Section chords → the app's bar text ("C | G | Am F"), `perBar` chords per bar. */
export function toBarText(chords: string[], perBar = 1): string {
  const bars: string[] = [];
  for (let i = 0; i < chords.length; i += perBar) bars.push(chords.slice(i, i + perBar).join(' '));
  return bars.join(' | ');
}

export function isKnownChord(symbol: string): boolean {
  return !Chord.get(splitSlash(symbol)[0]).empty;
}

/**
 * Re-spaces a section's chords so every chord lasts the same number of
 * beats (2 = two per bar, 4 = one bar, 8 = two bars). Pasted chord sheets
 * carry no timing, so this is how a song is lined up with the recording.
 */
export function respaceChords(chords: string, beats: 2 | 4 | 8): string {
  const syms = parseBars(chords).map((c) => c.symbol);
  if (beats === 8) return syms.map((s) => `${s}:8`).join(' | ');
  return toBarText(syms, beats === 2 ? 2 : 1);
}

/** Beats each chord lasts when they all share one length, else undefined. */
export function uniformChordBeats(chords: string): number | undefined {
  const evs = parseBars(chords);
  if (!evs.length) return undefined;
  const b = evs[0].beats;
  return evs.every((e) => Math.abs(e.beats - b) < 1e-6) ? b : undefined;
}

/** Transposes a bar string ("C G:2 | Am/E F") by an interval, keeping lengths and bar lines. */
export function transposeBarText(chords: string, ivl: string): string {
  return chords.replace(/[A-G][#b]?[^\s|:]*/g, (sym) => transposeChord(sym, ivl));
}
