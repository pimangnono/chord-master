export interface MidiConnection {
  inputs: string[];
  disconnect: () => void;
}

/** 'pedal' carries the sustain pedal state in `velocity` (1 = down, 0 = up) and note 64. */
export type MidiNoteHandler = (type: 'on' | 'off' | 'pedal', note: number, velocity: number) => void;

/** Connects to every Web MIDI input (digital pianos, controllers). Chrome only. */
export async function connectMidi(onNote: MidiNoteHandler, onInputsChange?: (names: string[]) => void): Promise<MidiConnection> {
  if (!('requestMIDIAccess' in navigator)) throw new Error('이 브라우저는 Web MIDI를 지원하지 않아요 (Chrome 권장)');
  const access = await navigator.requestMIDIAccess();
  const handler = (e: MIDIMessageEvent) => {
    const data = e.data;
    if (!data || data.length < 3) return;
    const cmd = data[0] & 0xf0;
    const note = data[1];
    const vel = data[2];
    if (cmd === 0x90 && vel > 0) onNote('on', note, vel / 127);
    else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) onNote('off', note, 0);
    else if (cmd === 0xb0 && note === 64) onNote('pedal', 64, vel >= 64 ? 1 : 0);
  };
  const attach = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = handler;
      names.push(input.name ?? 'MIDI 입력');
    });
    onInputsChange?.(names);
    return names;
  };
  const inputs = attach();
  access.onstatechange = () => attach();
  return {
    inputs,
    disconnect: () => {
      access.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
      access.onstatechange = null;
    },
  };
}
