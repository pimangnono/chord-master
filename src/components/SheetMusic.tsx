import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accidental,
  Barline,
  Beam,
  Dot,
  Formatter,
  GhostNote,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Voice,
} from 'vexflow';
import { playNotes } from '../audio/engine';
import type { RhythmPattern } from '../data/rhythms';
import { buildScore, ScoreItem, splitDuration, vexKey } from '../notation/score';
import { buildArrangement } from '../theory/arrange';
import { prettyChord, prettyNote, solfege } from '../theory/notes';
import type { ChordEvent } from '../theory/roman';
import { noteRole, VoicingMode } from '../theory/voicing';
import { movableDo, parseKey, shortKeyLabel } from '../theory/keys';

interface Hit {
  x: number;
  y: number;
  w: number;
  note: string;
  chord: string;
  hand: 'rh' | 'lh';
}

interface Mark {
  x: number;
  y: number;
  symbol: string;
  chord: number;
}

interface BarBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetMusicProps {
  chords: ChordEvent[];
  rhythm: RhythmPattern;
  keySig: string;
  activeBeat?: number;
  voicing?: VoicingMode;
  onChordClick?: (index: number) => void;
}

const LINE_H = 250;
const TREBLE_Y = 30;
const BASS_Y = 125;

export function SheetMusic({ chords, rhythm, keySig, activeBeat, voicing = 'smooth', onChordClick }: SheetMusicProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hits, setHits] = useState<Hit[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [boxes, setBoxes] = useState<BarBox[]>([]);
  const [tip, setTip] = useState<Hit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const score = useMemo(() => {
    const arr = buildArrangement(chords, rhythm, voicing);
    return { bars: buildScore(arr, chords), arr };
  }, [chords, rhythm, voicing]);

  useEffect(() => {
    const el = host.current;
    if (!el || width < 200) return;
    el.innerHTML = '';
    setError(null);
    try {
      const { bars } = score;
      const barsPerLine = Math.max(1, Math.min(4, Math.floor((width - 90) / 210)));
      const lines = Math.ceil(bars.length / barsPerLine);
      const renderer = new Renderer(el, Renderer.Backends.SVG);
      renderer.resize(width, lines * LINE_H);
      const ctx = renderer.getContext();
      const newHits: Hit[] = [];
      const newMarks: Mark[] = [];
      const newBoxes: BarBox[] = [];
      const ties: { a: StaveNote; b: StaveNote; n: number; lineA: number; lineB: number }[] = [];
      const pending: { rh?: { note: StaveNote; n: number; line: number }; lh?: { note: StaveNote; n: number; line: number } } = {};
      const extra = 80;
      const barW = (width - 12 - extra) / barsPerLine;

      bars.forEach((bar, bi) => {
        const line = Math.floor(bi / barsPerLine);
        const col = bi % barsPerLine;
        const first = col === 0;
        const x = 6 + (first ? 0 : extra + col * barW);
        const w = first ? barW + extra : barW;
        const y = line * LINE_H;
        const treble = new Stave(x, y + TREBLE_Y, w);
        const bass = new Stave(x, y + BASS_Y, w);
        if (first) {
          treble.addClef('treble').addKeySignature(keySig);
          bass.addClef('bass').addKeySignature(keySig);
          if (bi === 0) {
            treble.addTimeSignature('4/4');
            bass.addTimeSignature('4/4');
          }
        }
        if (bi === bars.length - 1) {
          treble.setEndBarType(Barline.type.END);
          bass.setEndBarType(Barline.type.END);
        }
        treble.setContext(ctx).draw();
        bass.setContext(ctx).draw();
        if (first) {
          new StaveConnector(treble, bass).setType(StaveConnector.type.BRACE).setContext(ctx).draw();
          new StaveConnector(treble, bass).setType(StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        }
        if (bi === bars.length - 1) {
          new StaveConnector(treble, bass).setType(StaveConnector.type.BOLD_DOUBLE_RIGHT).setContext(ctx).draw();
        } else {
          new StaveConnector(treble, bass).setType(StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
        }
        newBoxes.push({ x: treble.getNoteStartX() - 4, y: y + TREBLE_Y + 30, w: x + w - treble.getNoteStartX() + 4, h: BASS_Y - TREBLE_Y + 50 });

        const build = (items: ScoreItem[], clef: 'treble' | 'bass', hand: 'rh' | 'lh') => {
          const notes: StaveNote[] = [];
          const meta: { note: StaveNote; item: ScoreItem }[] = [];
          for (const item of items) {
            const pieces = splitDuration(item.start, item.len);
            pieces.forEach((p, pi) => {
              const rest = !item.notes;
              const keys = rest ? [clef === 'treble' ? 'b/4' : 'd/3'] : item.notes!.map(vexKey);
              const sn = new StaveNote({ keys, duration: p.dur + (rest ? 'r' : ''), clef, auto_stem: !rest });
              if (p.dur.includes('d')) Dot.buildAndAttach([sn], { all: true });
              notes.push(sn);
              if (!rest) {
                meta.push({ note: sn, item });
                const prevKey = hand;
                const pend = pending[prevKey];
                if (pi === 0 && pend) {
                  ties.push({ a: pend.note, b: sn, n: pend.n, lineA: pend.line, lineB: line });
                  pending[prevKey] = undefined;
                }
                if (pi > 0) ties.push({ a: notes[notes.length - 2], b: sn, n: keys.length, lineA: line, lineB: line });
                if (pi === pieces.length - 1 && item.tieToNext) pending[prevKey] = { note: sn, n: keys.length, line };
              }
            });
          }
          const voice = new Voice({ num_beats: 4, beat_value: 4 }).setMode(Voice.Mode.SOFT).addTickables(notes);
          return { voice, notes, meta };
        };
        const rh = build(bar.rh, 'treble', 'rh');
        const lh = build(bar.lh, 'bass', 'lh');

        // Ghost voice marks where chord symbols go.
        const ghosts: { g: GhostNote; mark?: (typeof bar.marks)[number] }[] = [];
        const cuts = [0, ...bar.marks.map((m) => m.pos).filter((p) => p > 0), 16];
        for (let i = 0; i < cuts.length - 1; i++) {
          const mark = bar.marks.find((m) => m.pos === cuts[i]);
          splitDuration(cuts[i], cuts[i + 1] - cuts[i]).forEach((p, pi) => {
            const g = new GhostNote({ duration: p.dur });
            if (p.dur.includes('d')) Dot.buildAndAttach([g], { all: true });
            ghosts.push({ g, mark: pi === 0 ? mark : undefined });
          });
        }
        const ghostVoice = new Voice({ num_beats: 4, beat_value: 4 }).setMode(Voice.Mode.SOFT).addTickables(ghosts.map((g) => g.g));

        Accidental.applyAccidentals([rh.voice], keySig);
        Accidental.applyAccidentals([lh.voice], keySig);
        const rhBeams = Beam.generateBeams(rh.notes.filter((n) => n.getDuration() !== 'w'));
        const lhBeams = Beam.generateBeams(lh.notes.filter((n) => n.getDuration() !== 'w'));
        const justify = Math.max(60, treble.getNoteEndX() - treble.getNoteStartX() - 16);
        new Formatter().joinVoices([rh.voice]).joinVoices([lh.voice]).joinVoices([ghostVoice]).format([rh.voice, lh.voice, ghostVoice], justify);
        rh.voice.draw(ctx, treble);
        lh.voice.draw(ctx, bass);
        ghostVoice.setStave(treble);
        ghosts.forEach(({ g }) => g.setStave(treble));
        [...rhBeams, ...lhBeams].forEach((b) => b.setContext(ctx).draw());

        for (const { g, mark } of ghosts) {
          if (mark) newMarks.push({ x: g.getAbsoluteX(), y: y + 2, symbol: mark.symbol, chord: mark.chord });
        }
        for (const [list, hand] of [
          [rh.meta, 'rh'],
          [lh.meta, 'lh'],
        ] as const) {
          for (const { note, item } of list) {
            const heads = [...note.noteHeads].sort((a, b) => b.getY() - a.getY());
            heads.forEach((h, i) => {
              const name = item.notes![i];
              if (!name) return;
              newHits.push({ x: h.getAbsoluteX(), y: h.getY(), w: h.getWidth() || 10, note: name, chord: chords[item.chord]?.symbol ?? '', hand });
            });
          }
        }
      });

      for (const t of ties) {
        const idx = Array.from({ length: t.n }, (_, i) => i);
        if (t.lineA === t.lineB) {
          new StaveTie({ first_note: t.a, last_note: t.b, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
        } else {
          new StaveTie({ first_note: t.a, last_note: null, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
          new StaveTie({ first_note: null, last_note: t.b, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
        }
      }
      setHits(newHits);
      setMarks(newMarks);
      setBoxes(newBoxes);
    } catch (e) {
      console.error(e);
      setError('악보를 그리는 중 문제가 생겼어요.');
    }
  }, [score, width, keySig, chords]);

  const activeBar = activeBeat !== undefined && activeBeat >= 0 ? Math.floor(activeBeat / 4) : -1;
  const box = boxes[activeBar];

  return (
    <div className="sheet" ref={wrap}>
      {box && <div className="sheet-cursor" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      <div ref={host} className="sheet-host" />
      {marks.map((m, i) => (
        <button key={i} className="sheet-chord" style={{ left: m.x - 4, top: m.y }} onClick={() => onChordClick?.(m.chord)}>
          {prettyChord(m.symbol)}
        </button>
      ))}
      {hits.map((h, i) => (
        <span
          key={i}
          className={`sheet-hit${tip === h ? ' on' : ''}`}
          style={{ left: h.x - 3, top: h.y - 6, width: h.w + 6 }}
          onMouseEnter={() => setTip(h)}
          onMouseLeave={() => setTip((t) => (t === h ? null : t))}
          onClick={() => playNotes([h.note], 1)}
        />
      ))}
      {tip && (
        <div className="sheet-tip" style={{ left: tip.x + tip.w / 2, top: tip.y - 14 }}>
          <div className="sheet-tip-main">
            <b>{solfege(tip.note)}</b>
            <span>{prettyNote(tip.note)}</span>
          </div>
          <div className="sheet-tip-sub movable">
            이동도 <b>{movableDo(tip.note, keySig)}</b> ({shortKeyLabel(keySig)} 기준{parseKey(keySig).minor ? ', 라 단조' : ''})
          </div>
          <div className="sheet-tip-sub">
            {prettyChord(tip.chord)}의 {noteRole(tip.note, tip.chord) ?? '음'} · {tip.hand === 'rh' ? '오른손' : '왼손'}
          </div>
        </div>
      )}
      {error && <p className="muted">{error}</p>}
    </div>
  );
}
