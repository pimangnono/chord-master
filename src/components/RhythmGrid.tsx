import type { DrumInst, RhythmPattern } from '../data/rhythms';

const ROWS: { id: string; label: string; match: (r: RhythmPattern) => { t: number; d: number; v: number }[] }[] = [
  {
    id: 'rh',
    label: '오른손',
    match: (r) => r.events.filter((e) => e.part === 'chord' || e.part.startsWith('arp')).map((e) => ({ t: e.t, d: e.d, v: e.vel ?? 0.6 })),
  },
  {
    id: 'lh',
    label: '왼손',
    match: (r) => r.events.filter((e) => !(e.part === 'chord' || e.part.startsWith('arp'))).map((e) => ({ t: e.t, d: e.d, v: e.vel ?? 0.6 })),
  },
  ...(
    [
      ['kick', '킥', ['kick']],
      ['snare', '스네어', ['snare', 'rim']],
      ['hat', '하이햇', ['hat', 'openhat', 'ride', 'shaker']],
    ] as [string, string, DrumInst[]][]
  ).map(([id, label, insts]) => ({
    id,
    label,
    match: (r: RhythmPattern) => (r.drums ?? []).filter((h) => insts.includes(h.inst)).map((h) => ({ t: h.t, d: 0.25, v: h.vel ?? 0.8 })),
  })),
];

const SUB = ['', 'e', '&', 'a'];

export function RhythmGrid({ rhythm, activeBeat }: { rhythm: RhythmPattern; activeBeat?: number }) {
  const steps = Math.round(rhythm.length * 4);
  const rows = ROWS.map((r) => ({ ...r, hits: r.match(rhythm) })).filter((r) => r.hits.length);
  const activeStep = activeBeat !== undefined && activeBeat >= 0 ? (activeBeat % rhythm.length) * 4 : -1;
  return (
    <div className="rgrid">
      <div className="rgrid-row rgrid-head">
        <span className="rgrid-label" />
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className={`rgrid-cell head${i % 4 === 0 ? ' beat' : ''}`}>
            {i % 4 === 0 ? (i / 4) % 4 + 1 : SUB[i % 4]}
          </span>
        ))}
      </div>
      {rows.map((row) => {
        const on = new Map<number, number>();
        const hold = new Set<number>();
        for (const h of row.hits) {
          const s = Math.round(h.t * 4);
          on.set(s, Math.max(on.get(s) ?? 0, h.v));
          for (let k = 1; k < Math.round(h.d * 4); k++) hold.add(s + k);
        }
        return (
          <div className="rgrid-row" key={row.id}>
            <span className="rgrid-label">{row.label}</span>
            {Array.from({ length: steps }, (_, i) => (
              <span
                key={i}
                className={`rgrid-cell${on.has(i) ? ' on' : hold.has(i) ? ' hold' : ''}${i % 4 === 0 ? ' beat' : ''}${activeStep >= 0 && Math.floor(i / 4) === Math.floor(activeStep / 4) ? ' now' : ''}`}
                style={on.has(i) ? { opacity: 0.45 + on.get(i)! * 0.6 } : undefined}
              />
            ))}
          </div>
        );
      })}
      {rhythm.swing ? <p className="rgrid-note">스윙 {Math.round(rhythm.swing * 100)}% — {rhythm.swing16 ? '16분음표' : '8분음표'} 뒷박을 늦게</p> : null}
    </div>
  );
}
