import { useRef, useState } from 'react';

/** Tempo from taps: the average of the last few intervals, restarting after a 2 s pause. */
export function tapBpm(times: number[]): number | undefined {
  if (times.length < 2) return undefined;
  const recent = times.slice(-9);
  const gaps = recent.slice(1).map((t, i) => t - recent[i]);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.round(60000 / avg);
}

/** Tap along with the recording to read its tempo. */
export function TapTempo({ onBpm }: { onBpm: (bpm: number) => void }) {
  const taps = useRef<number[]>([]);
  const [count, setCount] = useState(0);
  const tap = () => {
    const now = performance.now();
    const last = taps.current[taps.current.length - 1];
    if (last !== undefined && now - last > 2000) taps.current = [];
    taps.current.push(now);
    setCount(taps.current.length);
    const bpm = tapBpm(taps.current);
    if (bpm && bpm >= 40 && bpm <= 220) onBpm(bpm);
  };
  return (
    <button
      type="button"
      className="btn ghost small tap-btn"
      onPointerDown={(e) => {
        e.preventDefault();
        tap();
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          tap();
        }
      }}
      title="노래를 틀어 놓고 박자에 맞춰 여러 번 누르세요"
    >
      👆 박자 탭{count >= 2 ? ` (${count})` : ''}
    </button>
  );
}
