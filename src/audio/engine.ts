import { Note } from 'tonal';
import * as Tone from 'tone';
import type { DrumHit, DrumInst, RhythmPattern } from '../data/rhythms';
import { buildArrangement, swingTime } from '../theory/arrange';
import type { ChordEvent } from '../theory/roman';

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'fallback';

let status: AudioStatus = 'idle';
const statusListeners = new Set<(s: AudioStatus) => void>();
function setStatus(s: AudioStatus) {
  status = s;
  statusListeners.forEach((l) => l(s));
}
export function getAudioStatus() {
  return status;
}
export function onAudioStatus(l: (s: AudioStatus) => void) {
  statusListeners.add(l);
  return () => {
    statusListeners.delete(l);
  };
}

// Salamander Grand Piano (CC-BY 3.0, Alexander Holm) hosted by the Tone.js project.
const SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/';
function salamanderUrls() {
  const urls: Record<string, string> = { A0: 'A0.mp3', C8: 'C8.mp3' };
  for (let o = 1; o <= 7; o++) {
    urls[`C${o}`] = `C${o}.mp3`;
    urls[`D#${o}`] = `Ds${o}.mp3`;
    urls[`F#${o}`] = `Fs${o}.mp3`;
    urls[`A${o}`] = `A${o}.mp3`;
  }
  return urls;
}

type Instrument = Tone.Sampler | Tone.PolySynth;
let piano: Instrument | null = null;
let drumKit: Record<DrumInst, (time: number, vel: number) => void> | null = null;
let initPromise: Promise<void> | null = null;

function buildDrums(out: Tone.ToneAudioNode) {
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0 } }).connect(out);
  kick.volume.value = -6;
  const snareFilter = new Tone.Filter(1400, 'highpass').connect(out);
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }).connect(snareFilter);
  snare.volume.value = -12;
  const hatFilter = new Tone.Filter(7500, 'highpass').connect(out);
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.045, sustain: 0 } }).connect(hatFilter);
  hat.volume.value = -18;
  const open = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.22, sustain: 0 } }).connect(hatFilter);
  open.volume.value = -20;
  const shakerFilter = new Tone.Filter(5500, 'highpass').connect(out);
  const shaker = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.008, decay: 0.07, sustain: 0 } }).connect(shakerFilter);
  shaker.volume.value = -22;
  const ride = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.5, release: 0.2 }, harmonicity: 5.1, modulationIndex: 20, resonance: 5000, octaves: 1.2 }).connect(out);
  ride.volume.value = -30;
  const rim = new Tone.MembraneSynth({ pitchDecay: 0.005, octaves: 2, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).connect(out);
  rim.volume.value = -14;

  const last = new Map<string, number>();
  const guard = (name: string, time: number, fn: () => void) => {
    const prev = last.get(name) ?? -1;
    if (time <= prev) return; // monophonic synths cannot retrigger at the same instant
    last.set(name, time);
    fn();
  };
  return {
    kick: (t: number, v: number) => guard('kick', t, () => kick.triggerAttackRelease('C1', '8n', t, v)),
    snare: (t: number, v: number) => guard('snare', t, () => snare.triggerAttackRelease('16n', t, v)),
    hat: (t: number, v: number) => guard('hat', t, () => hat.triggerAttackRelease('32n', t, v)),
    openhat: (t: number, v: number) => guard('open', t, () => open.triggerAttackRelease('8n', t, v)),
    shaker: (t: number, v: number) => guard('shaker', t, () => shaker.triggerAttackRelease('32n', t, v)),
    ride: (t: number, v: number) => guard('ride', t, () => ride.triggerAttackRelease('C6', '8n', t, v)),
    rim: (t: number, v: number) => guard('rim', t, () => rim.triggerAttackRelease('G5', '32n', t, v)),
  };
}

/** Must be called from a user gesture the first time (browser autoplay policy). */
export function ensureAudio(): Promise<void> {
  const started = Tone.getContext().state === 'running' ? Promise.resolve() : Tone.start();
  if (initPromise) return started.then(() => initPromise!);
  initPromise = started.then(async () => {
    setStatus('loading');
    const reverb = new Tone.Reverb({ decay: 2.4, wet: 0.16 }).toDestination();
    const pianoOut = new Tone.Volume(-3).connect(reverb);
    const drumOut = new Tone.Volume(-4).toDestination();
    drumKit = buildDrums(drumOut);
    try {
      piano = await new Promise<Tone.Sampler>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 20000);
        const s = new Tone.Sampler({
          urls: salamanderUrls(),
          baseUrl: SAMPLE_BASE,
          release: 1.2,
          onload: () => {
            clearTimeout(timer);
            resolve(s);
          },
          onerror: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        }).connect(pianoOut);
      });
      setStatus('ready');
    } catch {
      // Offline fallback: a soft electric-piano-ish synth.
      piano = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 2,
        envelope: { attack: 0.005, decay: 1.2, sustain: 0.2, release: 1.2 },
        modulationEnvelope: { attack: 0.005, decay: 0.4, sustain: 0.1, release: 0.5 },
      }).connect(pianoOut);
      piano.volume.value = -10;
      setStatus('fallback');
    }
  });
  return initPromise;
}

function freqs(notes: string[]): number[] {
  return notes.map((n) => Tone.Frequency(Note.midi(n) ?? 60, 'midi').toFrequency());
}

export async function playNotes(notes: string[], duration = 1.4, velocity = 0.7) {
  await ensureAudio();
  if (!piano || !notes.length) return;
  piano.triggerAttackRelease(freqs(notes), duration, Tone.now() + 0.02, velocity);
}

/** Plays notes one after another (melodic interval / arpeggio). */
export async function playSequence(groups: string[][], gap = 0.6, duration = 0.9) {
  await ensureAudio();
  if (!piano) return;
  const now = Tone.now() + 0.05;
  groups.forEach((g, i) => piano!.triggerAttackRelease(freqs(g), duration, now + i * gap, 0.7));
}

export async function noteOn(note: string, velocity = 0.7) {
  await ensureAudio();
  piano?.triggerAttack(freqs([note]), Tone.now(), velocity);
}

export function noteOff(note: string) {
  piano?.triggerRelease(freqs([note]), Tone.now());
}

export interface PlayOptions {
  chords: ChordEvent[];
  rhythm: RhythmPattern;
  bpm: number;
  loop?: boolean;
  drums?: boolean;
  muteLH?: boolean;
  muteRH?: boolean;
  onChord?: (index: number) => void;
  onBeat?: (beat: number) => void;
  onEnd?: () => void;
}

class Player {
  private parts: Tone.Part[] = [];
  private loopId: number | null = null;
  private endId: number | null = null;
  playing = false;
  private opts: PlayOptions | null = null;

  async play(opts: PlayOptions) {
    await ensureAudio();
    this.stop();
    this.opts = opts;
    const transport = Tone.getTransport();
    const draw = Tone.getDraw();
    transport.bpm.value = opts.bpm;
    transport.position = 0;
    const ppq = transport.PPQ;
    const ticks = (beats: number) => `${Math.round(beats * ppq)}i`;
    const arr = buildArrangement(opts.chords, opts.rhythm);
    if (!arr.total) return;

    const notes = arr.events
      .filter((e) => !(e.hand === 'lh' && opts.muteLH) && !(e.hand === 'rh' && opts.muteRH))
      .map((e) => ({ time: ticks(swingTime(e.t, opts.rhythm)), e }));
    const notePart = new Tone.Part((time, { e }) => {
      if (!piano) return;
      const dur = Tone.Ticks(Math.round(e.d * ppq)).toSeconds() * 0.96;
      const vel = Math.min(1, Math.max(0.05, e.vel + (Math.random() - 0.5) * 0.06));
      piano.triggerAttackRelease(freqs(e.notes), dur, time, vel);
    }, notes);
    this.parts.push(notePart);

    if (opts.drums && drumKit) {
      const kit = drumKit;
      const drumPart = new Tone.Part(
        (time, { h }: { h: DrumHit }) => kit[h.inst](time, h.vel ?? 0.8),
        arr.drums.map((h) => ({ time: ticks(swingTime(h.t, opts.rhythm)), h })),
      );
      this.parts.push(drumPart);
    }

    const markerPart = new Tone.Part(
      (time, { i }: { i: number }) => draw.schedule(() => this.opts === opts && opts.onChord?.(i), time),
      arr.starts.map((s, i) => ({ time: ticks(s), i })),
    );
    this.parts.push(markerPart);

    for (const p of this.parts) {
      p.loop = !!opts.loop;
      p.loopEnd = ticks(arr.total);
      p.start(0);
    }

    let beat = 0;
    this.loopId = transport.scheduleRepeat(
      (time) => {
        const b = beat++ % Math.ceil(arr.total);
        draw.schedule(() => this.opts === opts && opts.onBeat?.(b), time);
      },
      '4n',
      0,
    );
    if (!opts.loop) {
      this.endId = transport.scheduleOnce((time) => {
        draw.schedule(() => {
          if (this.opts === opts) {
            this.stop();
            opts.onEnd?.();
          }
        }, time);
      }, ticks(arr.total));
    }
    this.playing = true;
    transport.start('+0.08');
  }

  setBpm(bpm: number) {
    Tone.getTransport().bpm.rampTo(bpm, 0.1);
  }

  stop() {
    const transport = Tone.getTransport();
    transport.stop();
    if (this.loopId !== null) transport.clear(this.loopId);
    if (this.endId !== null) transport.clear(this.endId);
    this.loopId = this.endId = null;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    piano?.releaseAll();
    this.playing = false;
    this.opts = null;
  }
}

export const player = new Player();
