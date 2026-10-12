import { Note } from 'tonal';
import { parseKey } from './keys';
import { ChordEvent, harmonicFunction, FunctionInfo, chordToRoman, romanToChord } from './roman';
import { chordToken, Style, suggestNext, TransitionStats } from './suggest';
import { inversionChoices, InversionTarget } from './inversion';
import { voiceChord } from './voicing';

export type DrillRange = 'diatonic' | 'color';
export type InversionMode = 'free' | 'random' | 'smooth';

export interface DrillOptions {
  key: string;
  style: Style;
  range: DrillRange;
  stats?: TransitionStats;
}

export interface DrillChord {
  symbol: string;
  numeral: string;
  fn: FunctionInfo;
  /** why this chord follows the previous one */
  reason: string;
}

const SEVENTH_STYLES: Style[] = ['jazz', 'bossa', 'hiphop', 'rnb'];

export function tonicChord(key: string, style: Style): DrillChord {
  const { minor } = parseKey(key);
  const numeral = SEVENTH_STYLES.includes(style) ? (minor ? 'i7' : 'Imaj7') : minor ? 'i' : 'I';
  const symbol = romanToChord(numeral, key);
  return { symbol, numeral, fn: harmonicFunction(symbol, key), reason: '으뜸화음(토닉)에서 출발해요' };
}

const isTonic = (symbol: string, key: string) => chordToken(symbol, key)?.startsWith('0:') ?? false;

/**
 * The next chord of a harmony-driven random walk. Candidates come from the
 * functional-harmony rules (plus the app's corpus statistics), weighted by
 * how natural each move is; phrases of 8 chords lean toward a dominant on
 * the 7th chord and a cadence home on the 8th, so the drill keeps forming
 * real progressions instead of random chords.
 *
 * @param pos index of the chord being chosen within the drill (0-based)
 */
export function nextDrillChord(prev: DrillChord, history: string[], pos: number, opts: DrillOptions, rng: () => number): DrillChord {
  const { key, style, range, stats } = opts;
  let cands = suggestNext(prev.symbol, key, { style, stats, limit: 10 });
  if (range === 'diatonic') cands = cands.filter((c) => ['T', 'S', 'D'].includes(harmonicFunction(c.symbol, key).code));
  // pop-like styles practise plain triads (plus dominant sevenths); jazz-like styles keep their extensions
  if (!SEVENTH_STYLES.includes(style)) cands = cands.filter((c) => /^[A-G][#b]?(m|dim|7)?$/.test(c.symbol));
  if (!cands.length) return { ...tonicChord(key, style), reason: '다시 으뜸화음으로 돌아와요' };

  const phrasePos = pos % 8;
  const prevFn = harmonicFunction(prev.symbol, key).code;
  const weights = cands.map((c) => {
    let w = c.score ** 2;
    if (c.symbol === history[history.length - 2]) w *= 0.35; // avoid ping-pong A–B–A
    const fn = harmonicFunction(c.symbol, key).code;
    if (phrasePos === 6 && (fn === 'D' || fn === 'SD')) w *= 2.5;
    if (phrasePos === 7 && (prevFn === 'D' || prevFn === 'SD') && isTonic(c.symbol, key)) w *= 5;
    if (phrasePos < 6 && isTonic(c.symbol, key) && history.length > 1) w *= 0.6; // don't settle too early
    return w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  let i = 0;
  for (; i < cands.length - 1; i++) {
    r -= weights[i];
    if (r <= 0) break;
  }
  const c = cands[i];
  const numeral = chordToRoman(c.symbol, key);
  const cadence = phrasePos === 7 && isTonic(c.symbol, key) && (prevFn === 'D' || prevFn === 'SD') ? ' — 프레이즈 끝, 종지!' : '';
  return { symbol: c.symbol, numeral, fn: harmonicFunction(c.symbol, key), reason: c.reasons[0] + cadence };
}

/** Required inversion for a chord. `smooth` picks the inversion closest to what was just played. */
export function pickInversion(symbol: string, mode: InversionMode, prevPlayed: number[] | undefined, rng: () => number): InversionTarget | null {
  const choices = inversionChoices(symbol);
  if (mode === 'free' || !choices.length) return null;
  if (mode === 'random') return choices[Math.floor(rng() * choices.length)];
  if (!prevPlayed?.length) return choices[0];
  const v = voiceChord(symbol, prevPlayed.map((m) => Note.fromMidi(m)), 'smooth');
  const low = Note.chroma(v.rh[0])!;
  return choices.find((c) => Note.chroma(c.bass) === low) ?? choices[0];
}

export function historyToProgression(history: string[]): ChordEvent[] {
  return history.map((symbol) => ({ symbol, beats: 4 }));
}
