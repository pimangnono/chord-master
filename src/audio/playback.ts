import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { AudioStatus, getAudioStatus, onAudioStatus, player, PlayOptions } from './engine';

interface PlaybackState {
  owner: string | null;
  chord: number;
  beat: number;
}

export const usePlayback = create<PlaybackState>(() => ({ owner: null, chord: -1, beat: -1 }));

export async function startPlayback(owner: string, opts: Omit<PlayOptions, 'onChord' | 'onBeat' | 'onEnd'>) {
  usePlayback.setState({ owner, chord: 0, beat: 0 });
  try {
    await player.play({
      ...opts,
      onChord: (chord) => usePlayback.setState({ chord }),
      onBeat: (beat) => usePlayback.setState({ beat }),
      onEnd: () => usePlayback.setState({ owner: null, chord: -1, beat: -1 }),
    });
  } catch (e) {
    usePlayback.setState({ owner: null, chord: -1, beat: -1 });
    throw e;
  }
}

export function stopPlayback() {
  player.stop();
  usePlayback.setState({ owner: null, chord: -1, beat: -1 });
}

export function useAudioStatus(): AudioStatus {
  const [s, setS] = useState(getAudioStatus());
  useEffect(() => onAudioStatus(setS), []);
  return s;
}
