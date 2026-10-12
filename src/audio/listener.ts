/**
 * Real-time polyphonic pitch estimation from the microphone.
 *
 * Pipeline: FFT (16384 pts) → peak magnitude per semitone band → iterative
 * harmonic-sum estimation with cancellation (a simplified Klapuri method):
 * pick the note whose harmonic series explains the most energy, attenuate its
 * harmonics, repeat. Works well for sustained piano chords.
 */

export interface DetectedNote {
  midi: number;
  strength: number;
}

export interface ListenFrame {
  /** 0..1 loudness */
  level: number;
  notes: DetectedNote[];
  chroma: number[];
  bass?: number;
  /** raw semitone spectrum (normalised) for visualisation */
  spectrum: Float32Array;
}

const LOW = 36; // C2
const HIGH = 96; // C7
const HARMONICS = [0, 12, 19, 24, 28, 31, 34, 36];
const WEIGHTS = [1, 0.85, 0.6, 0.5, 0.4, 0.33, 0.28, 0.25];
const TOP = 127;

function bandEdges(binHz: number, bins: number) {
  const lo = new Int32Array(TOP + 1);
  const hi = new Int32Array(TOP + 1);
  for (let m = 0; m <= TOP; m++) {
    const f = 440 * 2 ** ((m - 69) / 12);
    lo[m] = Math.max(1, Math.floor((f * 2 ** (-0.45 / 12)) / binHz));
    hi[m] = Math.min(bins - 1, Math.max(lo[m], Math.ceil((f * 2 ** (0.45 / 12)) / binHz)));
  }
  return { lo, hi };
}

let edgeCache: { key: string; lo: Int32Array; hi: Int32Array } | null = null;

/**
 * Estimates the notes sounding in one spectrum frame.
 * @param dbSpectrum magnitude spectrum in dB (as AnalyserNode.getFloatFrequencyData returns)
 * @param binHz frequency resolution
 * @param rms time-domain RMS of the frame
 * @param sensitivity 0..1 — higher picks up quieter notes (and more noise)
 */
export function analyzeSpectrum(dbSpectrum: Float32Array, binHz: number, rms: number, sensitivity = 0.5): ListenFrame {
  const key = `${binHz}:${dbSpectrum.length}`;
  if (edgeCache?.key !== key) edgeCache = { key, ...bandEdges(binHz, dbSpectrum.length) };
  const { lo, hi } = edgeCache;
  const level = Math.min(1, rms * 8);

  const band = new Float32Array(TOP + 2);
  for (let m = LOW - 1; m <= TOP; m++) {
    let peak = 0;
    for (let b = lo[m]; b <= hi[m]; b++) {
      const mag = 10 ** (dbSpectrum[b] / 20);
      if (mag > peak) peak = mag;
    }
    band[m] = peak;
  }
  // Normalise and estimate the noise floor from the median band value.
  let max = 0;
  for (let m = LOW; m <= TOP; m++) max = Math.max(max, band[m]);
  const spectrum = new Float32Array(TOP + 2);
  if (max > 0) for (let m = 0; m <= TOP; m++) spectrum[m] = band[m] / max;
  const sorted = Array.from(spectrum.slice(LOW, TOP)).sort((x, y) => x - y);
  const floor = sorted[Math.floor(sorted.length / 2)] ?? 0;

  const gate = 0.02 - sensitivity * 0.017; // rms threshold
  if (rms < gate || max === 0) return { level, notes: [], chroma: new Array(12).fill(0), spectrum };

  const resid = Float32Array.from(spectrum);
  const notes: DetectedNote[] = [];
  let first = 0;
  const rel = 0.32 - sensitivity * 0.2;
  for (let iter = 0; iter < 6; iter++) {
    let best = -1;
    let bestSal = 0;
    for (let m = LOW; m <= HIGH; m++) {
      // In the bass, FFT leakage smears a note into its semitone neighbours; real voicings rarely cluster there.
      if (m < 60 && notes.some((n) => Math.abs(n.midi - m) <= 2)) continue;
      const f0 = resid[m];
      if (f0 < floor * 2.2 || f0 < 0.04) continue; // fundamental must stand out of the noise
      let sal = 0;
      for (let h = 0; h < HARMONICS.length; h++) {
        const k = m + HARMONICS[h];
        if (k > TOP) break;
        sal += WEIGHTS[h] * resid[k];
      }
      // A real fundamental is a local spectral peak.
      if (resid[m] < resid[m - 1] * 0.8 || resid[m] < resid[m + 1] * 0.8) sal *= 0.5;
      if (sal > bestSal) {
        bestSal = sal;
        best = m;
      }
    }
    if (best < 0) break;
    if (!first) first = bestSal;
    else if (bestSal < first * rel) break;
    notes.push({ midi: best, strength: bestSal / first });
    // cancel this note's harmonic series
    const amp = resid[best];
    for (let h = 0; h < HARMONICS.length; h++) {
      const k = best + HARMONICS[h];
      if (k > TOP) break;
      resid[k] = Math.max(0, resid[k] - amp * WEIGHTS[h] * 0.9);
      if (k < 64) {
        resid[k - 1] = Math.max(0, resid[k - 1] - amp * WEIGHTS[h] * 0.4);
        resid[k + 1] = Math.max(0, resid[k + 1] - amp * WEIGHTS[h] * 0.4);
      }
    }
    resid[best] = 0;
  }

  const chroma = new Array(12).fill(0);
  for (const n of notes) chroma[n.midi % 12] += Math.sqrt(n.strength);
  const solid = notes.filter((n) => n.strength >= 0.15);
  const bass = solid.length ? Math.min(...solid.map((n) => n.midi)) : undefined;
  return { level, notes, chroma, bass, spectrum };
}

export class MicListener {
  private ctx?: AudioContext;
  private analyser?: AnalyserNode;
  private stream?: MediaStream;
  private spec = new Float32Array(0);
  private time = new Float32Array(0);
  private binHz = 0;

  get running() {
    return !!this.ctx;
  }

  async start(deviceId?: string) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const ctx = new AudioContext();
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(this.stream);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 45;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 16384;
    analyser.smoothingTimeConstant = 0.25;
    analyser.minDecibels = -110;
    analyser.maxDecibels = -10;
    src.connect(hp).connect(analyser);
    this.analyser = analyser;
    this.spec = new Float32Array(analyser.frequencyBinCount);
    this.time = new Float32Array(analyser.fftSize);
    this.binHz = ctx.sampleRate / analyser.fftSize;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = undefined;
    this.analyser = undefined;
  }

  analyze(sensitivity = 0.5): ListenFrame | null {
    const a = this.analyser;
    if (!a) return null;
    a.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
    const rms = Math.sqrt(sum / this.time.length);
    a.getFloatFrequencyData(this.spec);
    return analyzeSpectrum(this.spec, this.binHz, rms, sensitivity);
  }
}

export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}
