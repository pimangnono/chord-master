import { useMemo, useState } from 'react';
import { movableDo } from '../theory/keys';
import { isBlackKey, midiToNote, solfege } from '../theory/notes';
import { useStore } from '../store';
import { useMidi } from '../audio/midiHub';

export interface PianoProps {
  from?: number;
  to?: number;
  /** midi → highlight style */
  marks?: Map<number, 'active' | 'root' | 'hint' | 'correct' | 'wrong'>;
  onDown?: (midi: number) => void;
  onUp?: (midi: number) => void;
  height?: number;
  preferFlats?: boolean;
  /** extra per-key caption under the label (e.g. chord role) */
  captions?: Map<number, string>;
  /** key for 이동도법 labels; without it only fixed-do is shown */
  keyName?: string;
}

export function Piano({ from = 48, to = 84, marks, onDown, onUp, height = 150, preferFlats, captions, keyName }: PianoProps) {
  const labels = useStore((s) => s.pianoLabels);
  const midiHeld = useMidi((s) => s.held);
  const [hover, setHover] = useState<number | null>(null);
  const [down, setDown] = useState<number | null>(null);
  const keys = useMemo(() => {
    const out: number[] = [];
    for (let m = from; m <= to; m++) out.push(m);
    return out;
  }, [from, to]);
  const whites = keys.filter((m) => !isBlackKey(m));
  const whiteW = 100 / whites.length;

  const posOfWhite = (m: number) => whites.indexOf(m);
  const showMovable = !!keyName && (labels === 'both' || labels === 'movable');
  const label = (m: number) => {
    const n = midiToNote(m, preferFlats);
    if (labels === 'none') return '';
    if (labels === 'letters') return n.replace(/-?\d+$/, '');
    if (labels === 'movable' && keyName) return movableDo(n, keyName);
    return solfege(n);
  };
  /** second line: 이동도 under the fixed-do label */
  const movable = (m: number) => (showMovable && labels === 'both' ? <i>{movableDo(midiToNote(m, preferFlats), keyName!)}</i> : null);

  const press = (m: number) => {
    setDown(m);
    onDown?.(m);
  };
  const release = (m: number) => {
    if (down === m) {
      setDown(null);
      onUp?.(m);
    }
  };

  const keyClass = (m: number) => {
    const mark = marks?.get(m);
    return `key ${isBlackKey(m) ? 'black' : 'white'}${mark ? ' ' + mark : ''}${down === m ? ' pressed' : ''}${midiHeld.includes(m) ? ' midi' : ''}`;
  };

  return (
    <div className="piano" style={{ height }} onPointerLeave={() => down !== null && release(down)}>
      {whites.map((m) => (
        <div
          key={m}
          data-midi={m}
          className={keyClass(m)}
          style={{ left: `${posOfWhite(m) * whiteW}%`, width: `${whiteW}%` }}
          onPointerDown={(e) => {
            e.preventDefault();
            press(m);
          }}
          onPointerUp={() => release(m)}
          onPointerEnter={() => setHover(m)}
          onPointerOut={() => setHover((h) => (h === m ? null : h))}
        >
          <span className="key-label">
            {captions?.get(m) && <em>{captions.get(m)}</em>}
            {movable(m)}
            {label(m)}
            {m % 12 === 0 && labels !== 'none' && <small>{Math.floor(m / 12) - 1}</small>}
          </span>
        </div>
      ))}
      {keys
        .filter((m) => isBlackKey(m))
        .map((m) => {
          const leftWhite = posOfWhite(m - 1);
          const offset = [1, 6].includes(m % 12) ? 0.62 : [3, 10].includes(m % 12) ? 0.72 : 0.67;
          return (
            <div
              key={m}
              data-midi={m}
              className={keyClass(m)}
              style={{ left: `${(leftWhite + offset) * whiteW}%`, width: `${whiteW * 0.62}%` }}
              onPointerDown={(e) => {
                e.preventDefault();
                press(m);
              }}
              onPointerUp={() => release(m)}
              onPointerEnter={() => setHover(m)}
              onPointerOut={() => setHover((h) => (h === m ? null : h))}
            >
              {(marks?.has(m) || captions?.has(m)) && (
                <span className="key-label">
                  {captions?.get(m) && <em>{captions.get(m)}</em>}
                  {movable(m)}
                  {label(m)}
                </span>
              )}
            </div>
          );
        })}
      {hover !== null && (
        <div
          className="piano-tip"
          style={{ left: `${(isBlackKey(hover) ? posOfWhite(hover - 1) + 1 : posOfWhite(hover) + 0.5) * whiteW}%` }}
        >
          <b>{solfege(midiToNote(hover, preferFlats))}</b>
          {keyName && <span className="movable"> · 이동도 {movableDo(midiToNote(hover, preferFlats), keyName)}</span>}{' '}
          {midiToNote(hover, preferFlats).replace('#', '♯').replace(/([A-G])b/, '$1♭')}
        </div>
      )}
    </div>
  );
}
