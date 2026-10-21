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
  /** absolute position in 16ths */
  t16: number;
  /** a new key press (not a tie continuation) */
  onset: boolean;
  /** the rendered notehead, recoloured during 따라치기 */
  el?: SVGElement;
}

export interface FollowView {
  /** t16 of the notes to play now, or null */
  cur: number | null;
  /** the beat has reached them (shown red) */
  due: boolean;
  done: Set<number>;
  hands: 'both' | 'rh' | 'lh';
  /** beat position in 16ths, for the timing guide on the hand not being practised */
  guide?: number | null;
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
  /** wait-mode practice highlighting */
  follow?: FollowView;
  onChordClick?: (index: number) => void;
  /** turn the page for the player: keep the line being played near the top of the window */
  autoScroll?: boolean;
  /** px covered at the top of the window (e.g. a sticky control bar) */
  scrollOffset?: () => number;
}

const LINE_H = 250;
const TREBLE_Y = 30;
const BASS_Y = 125;
/** extra room under each system for a line of lyrics */
const LYRIC_H = 56;
/** lyrics sit under the bass staff, clear of its stems and low ledger notes */
const LYRIC_Y = BASS_Y + 120;

export function SheetMusic({ chords, rhythm, keySig, activeBeat, voicing = 'smooth', follow, onChordClick, autoScroll = false, scrollOffset }: SheetMusicProps) {
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

  const hasLyrics = chords.some((c) => c.lyric?.trim());
  const lineH = LINE_H + (hasLyrics ? LYRIC_H : 0);
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
      renderer.resize(width, lines * lineH);
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
        const y = line * lineH;
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
          const meta: { note: StaveNote; item: ScoreItem; t16: number; onset: boolean }[] = [];
          for (const item of items) {
            const pieces = splitDuration(item.start, item.len);
            pieces.forEach((p, pi) => {
              const rest = !item.notes;
              const keys = rest ? [clef === 'treble' ? 'b/4' : 'd/3'] : item.notes!.map(vexKey);
              const sn = new StaveNote({ keys, duration: p.dur + (rest ? 'r' : ''), clef, auto_stem: !rest });
              if (p.dur.includes('d')) Dot.buildAndAttach([sn], { all: true });
              notes.push(sn);
              if (!rest) {
                meta.push({ note: sn, item, t16: bi * 16 + p.start, onset: pi === 0 && !item.cont });
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
          for (const { note, item, t16, onset } of list) {
            const heads = [...note.noteHeads].sort((a, b) => b.getY() - a.getY());
            heads.forEach((h, i) => {
              const name = item.notes![i];
              if (!name) return;
              newHits.push({ x: h.getAbsoluteX(), y: h.getY(), w: h.getWidth() || 10, note: name, chord: chords[item.chord]?.symbol ?? '', hand, t16, onset, el: h.getSVGElement() });
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
  }, [score, width, keySig, chords, lineH]);

  const activeBar = activeBeat !== undefined && activeBeat >= 0 ? Math.floor(activeBeat / 4) : -1;
  // the chord (and so the words) being played right now
  let sungChord = -1;
  if (activeBeat !== undefined && activeBeat >= 0) score.arr.starts.forEach((st, i) => st <= activeBeat + 1e-6 && (sungChord = i));
  const box = boxes[activeBar];

  // 따라치기: colour the noteheads themselves (red = play now, orange = coming up, green = played)
  useEffect(() => {
    // the other hand lights up on its own beats, following the practice clock
    const guide = follow?.guide;
    let latest = -1;
    if (follow && follow.hands !== 'both' && guide !== null && guide !== undefined) {
      for (const h of hits) if (h.onset && h.hand !== follow.hands && h.t16 <= guide + 0.01 && h.t16 > latest) latest = h.t16;
    }
    for (const h of hits) {
      if (!h.el) continue;
      const practised = !!follow && (follow.hands === 'both' || follow.hands === h.hand);
      let state = '';
      if (follow && h.onset && practised) state = h.t16 === follow.cur ? (follow.due ? 'cur' : 'next') : follow.done.has(h.t16) ? 'done' : '';
      else if (follow && h.onset && latest >= 0) state = h.t16 === latest ? 'cur' : h.t16 < latest ? 'past' : '';
      h.el.classList.toggle('fol-cur', state === 'cur');
      h.el.classList.toggle('fol-next', state === 'next');
      h.el.classList.toggle('fol-done', state === 'done');
      h.el.classList.toggle('fol-past', state === 'past');
    }
  }, [hits, follow]);
  // Page turning: when the music moves to a new line, scroll so that line sits
  // just under whatever is pinned at the top, with the next lines visible below.
  // A sheet that fits on screen is only brought fully into view.
  const lineTop = box?.y;
  useEffect(() => {
    if (!autoScroll || lineTop === undefined || !wrap.current) return;
    const top = (scrollOffset?.() ?? 0) + 8;
    const sheet = wrap.current.getBoundingClientRect();
    const room = window.innerHeight - top;
    let target: number;
    if (sheet.height <= room) {
      if (sheet.top >= top && sheet.bottom <= window.innerHeight) return;
      target = sheet.top - top;
    } else {
      target = sheet.top + lineTop - top;
    }
    if (Math.abs(target) < 4) return;
    window.scrollTo({ top: window.scrollY + target, behavior: 'smooth' });
  }, [lineTop, autoScroll, scrollOffset]);

  return (
    <div className="sheet" ref={wrap}>
      {box && <div className="sheet-cursor" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      <div ref={host} className="sheet-host" />
      {marks.map((m, i) => (
        <button key={i} className="sheet-chord" style={{ left: m.x - 4, top: m.y }} onClick={() => onChordClick?.(m.chord)}>
          {prettyChord(m.symbol)}
        </button>
      ))}
      {hasLyrics &&
        marks.map((m, i) => {
          const words = chords[m.chord]?.lyric?.trim();
          if (!words) return null;
          // room up to the next chord on the same line, else to the end of the line
          const next = marks[i + 1];
          const room = (next && next.y === m.y ? next.x : width - 8) - m.x;
          return (
            <div key={`l${i}`} className={`sheet-lyric${m.chord === sungChord ? ' on' : ''}`} style={{ left: m.x - 2, top: m.y - 2 + LYRIC_Y, maxWidth: Math.max(36, room - 4) }}>
              {words}
            </div>
          );
        })}
      {hits.map((h, i) => {
        return (
        <span
          key={i}
          className={`sheet-hit${tip === h ? ' on' : ''}`}
          style={{ left: h.x - 3, top: h.y - 6, width: h.w + 6 }}
          onMouseEnter={() => setTip(h)}
          onMouseLeave={() => setTip((t) => (t === h ? null : t))}
          onClick={() => playNotes([h.note], 1)}
        />
        );
      })}
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
