/**
 * One app-wide Web MIDI connection. Connect once (sidebar) and every page
 * sees the keys being held, can react to notes, and hears them through the
 * app's piano — with velocity and sustain pedal — when sound is on.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { IS_ARTIFACT } from '../platform';
import { audioReady, ensureAudio, liveNoteOff, liveNoteOn } from './engine';
import { connectMidi, MidiConnection } from './midi';

export type MidiStatus = 'off' | 'connecting' | 'on' | 'unsupported' | 'error';

interface MidiState {
  status: MidiStatus;
  error?: string;
  inputs: string[];
  /** keys physically held, ascending */
  held: number[];
  pedal: boolean;
  /** the app plays piano sound for MIDI notes */
  sound: boolean;
  /** reconnect automatically on the next visit */
  autoConnect: boolean;
  /** false until the browser lets the page make sound (first click) */
  audible: boolean;
}

export const useMidi = create<MidiState>()(
  persist(
    (): MidiState => ({
      status: IS_ARTIFACT || (typeof navigator !== 'undefined' && !('requestMIDIAccess' in navigator)) ? 'unsupported' : 'off',
      inputs: [],
      held: [],
      pedal: false,
      sound: true,
      autoConnect: false,
      audible: false,
    }),
    { name: 'chord-master-midi', partialize: (s) => ({ sound: s.sound, autoConnect: s.autoConnect }) },
  ),
);

export interface MidiNoteEvent {
  type: 'on' | 'off';
  note: number;
  velocity: number;
  /** keys held after this event */
  held: number[];
}

const listeners = new Set<(e: MidiNoteEvent) => void>();

/** Subscribe to note on/off events; returns the unsubscribe function. */
export function onMidiNote(fn: (e: MidiNoteEvent) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let conn: MidiConnection | null = null;
const held = new Set<number>();
const sounding = new Set<number>();
const sustained = new Set<number>();

function publishHeld() {
  useMidi.setState({ held: [...held].sort((a, b) => a - b) });
}

function handle(type: 'on' | 'off' | 'pedal', note: number, velocity: number) {
  const { sound } = useMidi.getState();
  if (type === 'pedal') {
    const down = velocity > 0;
    useMidi.setState({ pedal: down });
    if (!down) {
      for (const n of sustained) {
        if (!held.has(n)) {
          liveNoteOff(n);
          sounding.delete(n);
        }
      }
      sustained.clear();
    }
    return;
  }
  if (type === 'on') {
    held.add(note);
    sustained.delete(note);
    if (sound) {
      if (sounding.has(note)) liveNoteOff(note);
      if (liveNoteOn(note, velocity)) sounding.add(note);
      else if (!useMidi.getState().audible) ensureAudio().then(() => useMidi.setState({ audible: audioReady() }));
    }
  } else {
    held.delete(note);
    if (sounding.has(note)) {
      if (useMidi.getState().pedal) sustained.add(note);
      else {
        liveNoteOff(note);
        sounding.delete(note);
      }
    }
  }
  publishHeld();
  const ev: MidiNoteEvent = { type, note, velocity, held: useMidi.getState().held };
  listeners.forEach((l) => l(ev));
}

/** The browser only allows sound after a user gesture: unlock it on the first click or key press. */
function unlockAudioOnGesture() {
  if (audioReady()) {
    useMidi.setState({ audible: true });
    return;
  }
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    ensureAudio().then(() => useMidi.setState({ audible: audioReady() }));
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** @param fromClick true when called from a button press (lets audio start right away) */
export async function connectMidiHub(fromClick = false) {
  const st = useMidi.getState();
  if (st.status === 'unsupported' || st.status === 'connecting' || st.status === 'on') return;
  useMidi.setState({ status: 'connecting', error: undefined });
  if (fromClick) ensureAudio().then(() => useMidi.setState({ audible: audioReady() }));
  else unlockAudioOnGesture();
  try {
    conn = await connectMidi(handle, (inputs) => useMidi.setState({ inputs }));
    useMidi.setState({ status: 'on', inputs: conn.inputs, autoConnect: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const denied = /denied|permission|NotAllowed|SecurityError/i.test(msg);
    useMidi.setState({
      status: 'error',
      error: denied ? 'MIDI 사용 권한이 거부됐어요. 주소창 왼쪽 자물쇠 → 사이트 설정에서 MIDI를 허용해 주세요.' : msg,
      autoConnect: false,
    });
  }
}

export function disconnectMidiHub() {
  conn?.disconnect();
  conn = null;
  for (const n of sounding) liveNoteOff(n);
  sounding.clear();
  sustained.clear();
  held.clear();
  useMidi.setState({ status: 'off', inputs: [], held: [], pedal: false, autoConnect: false });
}

export function setMidiSound(on: boolean) {
  if (!on) {
    for (const n of sounding) liveNoteOff(n);
    sounding.clear();
    sustained.clear();
  }
  useMidi.setState({ sound: on });
}

/** Reconnects on app start when the person connected before (Chrome remembers the permission). */
export function autoConnectMidi() {
  const st = useMidi.getState();
  if (st.autoConnect && st.status === 'off') connectMidiHub(false);
}
