import { useCallback, useEffect, useRef, useState } from 'react';
import { onMidiNote } from '../audio/midiHub';
import type { FollowStep } from '../notation/score';

export interface FollowResult {
  steps: number;
  errors: number;
  /** mean absolute timing error in ms (presses against when the notes turned red) */
  meanTiming: number;
  seconds: number;
}

/**
 * Wait-mode practice ("따라치기"). The current notes turn red when the beat
 * reaches them; the cursor only moves on once those exact keys are pressed.
 * After a correct press, the next notes are due one note-length later, so a
 * steady player stays in tempo and a hesitating player is simply waited for.
 */
export function useFollow(steps: FollowStep[], bpm: number, octaveFree: boolean) {
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [isDue, setIsDue] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState(0);
  const [wrongNote, setWrongNote] = useState<number | null>(null);
  const [lastTiming, setLastTiming] = useState<number | null>(null);
  const [result, setResult] = useState<FollowResult | null>(null);

  const s = useRef({ idx: 0, due: 0, struck: new Set<number>(), timings: [] as number[], errors: 0, startedAt: 0, active: false });
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;
  const octRef = useRef(octaveFree);
  octRef.current = octaveFree;

  const stop = useCallback(() => {
    s.current.active = false;
    setActive(false);
  }, []);

  const start = useCallback(() => {
    s.current = { idx: 0, due: performance.now() + 800, struck: new Set(), timings: [], errors: 0, startedAt: performance.now(), active: true };
    setIdx(0);
    setDone(new Set());
    setErrors(0);
    setLastTiming(null);
    setResult(null);
    setIsDue(false);
    setActive(true);
  }, []);

  // turn the current notes red when their beat arrives
  useEffect(() => {
    if (!active) return;
    const wait = s.current.due - performance.now();
    if (wait <= 0) {
      setIsDue(true);
      return;
    }
    setIsDue(false);
    const t = setTimeout(() => setIsDue(true), wait);
    return () => clearTimeout(t);
  }, [active, idx]);

  const press = useCallback((midi: number) => {
    const st = s.current;
    const list = stepsRef.current;
    if (!st.active || st.idx >= list.length) return;
    const step = list[st.idx];
    const key = (m: number) => (octRef.current ? ((m % 12) + 12) % 12 : m);
    const wanted = new Set(step.notes.map(key));
    if (!wanted.has(key(midi))) {
      st.errors++;
      setErrors(st.errors);
      setWrongNote(midi);
      setTimeout(() => setWrongNote((w) => (w === midi ? null : w)), 450);
      return;
    }
    st.struck.add(key(midi));
    if (![...wanted].every((k) => st.struck.has(k))) return;

    const now = performance.now();
    const timing = now - st.due;
    st.timings.push(timing);
    setLastTiming(timing);
    setDone((d) => new Set(d).add(step.t16));
    st.struck = new Set();
    st.idx++;
    if (st.idx >= list.length) {
      st.active = false;
      setActive(false);
      setResult({
        steps: list.length,
        errors: st.errors,
        meanTiming: st.timings.reduce((a, t) => a + Math.abs(t), 0) / Math.max(1, st.timings.length),
        seconds: (now - st.startedAt) / 1000,
      });
      setIdx(st.idx);
      return;
    }
    const gapBeats = (list[st.idx].t16 - step.t16) / 4;
    st.due = Math.max(st.due, now) + (gapBeats * 60000) / bpmRef.current;
    setIdx(st.idx);
  }, []);

  useEffect(() => onMidiNote((e) => e.type === 'on' && press(e.note)), [press]);

  /**
   * Where the beat is now, in 16ths: it runs at tempo from the last correct
   * press and stops at the notes being waited for. Drives the timing guide
   * for the hand that is not being practised.
   */
  const beatPosition = useCallback((): number | null => {
    const st = s.current;
    const cur = stepsRef.current[st.idx];
    if (!st.active || !cur) return null;
    const now = performance.now();
    if (now >= st.due) return cur.t16;
    return cur.t16 - ((st.due - now) / (60000 / bpmRef.current)) * 4;
  }, []);

  // a new arrangement (hand, rhythm, key…) restarts nothing silently: stop instead
  useEffect(() => stop(), [steps, stop]);

  const current = active ? steps[idx] : undefined;
  return { active, start, stop, press, beatPosition, idx, isDue, done, errors, wrongNote, lastTiming, result, current, total: steps.length };
}

export function timingLabel(ms: number | null): string {
  if (ms === null) return '';
  if (Math.abs(ms) < 150) return '정확해요!';
  return ms < 0 ? '조금 빨라요' : '조금 늦어요';
}
