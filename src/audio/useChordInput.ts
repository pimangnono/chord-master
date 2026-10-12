import { useCallback, useEffect, useRef, useState } from 'react';
import { Chord, Note } from 'tonal';
import { detectFromChroma, detectFromMidi } from '../theory/detect';
import { splitSlash } from '../theory/notes';
import { appSoundBusy } from './engine';
import { MicListener } from './listener';
import { onMidiNote, useMidi } from './midiHub';

export type ChordSource = 'midi' | 'mic' | 'screen';

export interface PlayedChord {
  /** the notes (MIDI numbers) or, for the mic, the recognised chord's notes */
  notes: number[];
  /** best chord name for display */
  label: string;
  source: ChordSource;
}

function symbolNotes(symbol: string): number[] {
  const [main, bass] = splitSlash(symbol);
  const n = Chord.get(main).notes.map((x) => Note.midi(x + '4')!);
  if (bass) n.unshift(Note.midi(bass + '3')!);
  return n;
}

/**
 * Turns live playing into chord "answers":
 *  - MIDI: a chord is submitted once the held keys settle (180 ms after the last key);
 *    the same chord is submitted again only after all keys are released.
 *  - Microphone: a chord recognised steadily for a few frames is submitted; repeats need
 *    a moment of silence. While the app itself is playing, the mic is ignored.
 */
export function useChordInput(enabled: boolean, onChord: (c: PlayedChord) => void) {
  const cb = useRef(onChord);
  cb.current = onChord;
  const active = useRef(enabled);
  active.current = enabled;

  // ── MIDI ──
  useEffect(() => {
    let timer: number | undefined;
    let lastSig = '';
    return onMidiNote((e) => {
      if (e.held.length === 0) lastSig = '';
      if (e.type !== 'on') return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const now = useMidi.getState().held; // keys still down once the chord has settled
        if (!active.current || now.length < 2) return;
        const sig = [...new Set(now.map((m) => m % 12))].sort().join(',');
        if (sig === lastSig) return;
        lastSig = sig;
        cb.current({ notes: now, label: detectFromMidi(now)[0]?.symbol ?? '?', source: 'midi' });
      }, 180);
    });
  }, []);

  // ── microphone ──
  const listener = useRef<MicListener | null>(null);
  const raf = useRef(0);
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [hearing, setHearing] = useState<string | null>(null);

  const stopMic = useCallback(() => {
    cancelAnimationFrame(raf.current);
    listener.current?.stop();
    listener.current = null;
    setMicOn(false);
    setLevel(0);
  }, []);

  const startMic = useCallback(async () => {
    setMicError(null);
    try {
      const l = new MicListener();
      await l.start();
      listener.current = l;
      setMicOn(true);
      const ema = new Array(12).fill(0);
      let lastLevel = 0;
      let cand = '';
      let count = 0;
      let quiet = 0;
      let emitted = '';
      let frame = 0;
      const tick = () => {
        const f = listener.current?.analyze(0.5);
        if (!f) return;
        frame++;
        if (frame % 3 === 0) setLevel(f.level);
        if (appSoundBusy()) {
          ema.fill(0);
          cand = '';
          count = 0;
        } else if (!f.notes.length) {
          for (let i = 0; i < 12; i++) ema[i] *= 0.8;
          if (++quiet > 10) {
            emitted = '';
            setHearing(null);
          }
        } else {
          quiet = 0;
          const onset = f.level > lastLevel * 1.5 + 0.03;
          for (let i = 0; i < 12; i++) ema[i] = onset ? f.chroma[i] : ema[i] * 0.55 + f.chroma[i] * 0.45;
          const top = detectFromChroma(ema, f.bass !== undefined ? f.bass % 12 : undefined)[0];
          if (top && top.score > 0.78 && f.notes.length >= 2) {
            if (top.symbol === cand) count++;
            else {
              cand = top.symbol;
              count = 1;
            }
            if (count === 4) {
              setHearing(top.symbol);
              if (top.symbol !== emitted && active.current) {
                emitted = top.symbol;
                cb.current({ notes: symbolNotes(top.symbol), label: top.symbol, source: 'mic' });
              }
            }
          }
        }
        lastLevel = f.level;
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      setMicError(`마이크를 사용할 수 없어요: ${e instanceof Error ? e.message : e}`);
      stopMic();
    }
  }, [stopMic]);

  useEffect(() => stopMic, [stopMic]);

  return { micOn, micError, level, hearing, startMic, stopMic };
}
