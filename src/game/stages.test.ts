import { Chord, Note } from 'tonal';
import { describe, expect, it, vi } from 'vitest';
import { chordMatches } from '../theory/detect';

vi.mock('../audio/engine', () => ({ playNotes: vi.fn(), playSequence: vi.fn() }));

const { seededRng, STAGES } = await import('./stages');

describe('game stages', () => {
  it('has a progression track that starts unlocked', () => {
    const prog = STAGES.filter((s) => s.track === 'progression');
    expect(prog.map((s) => s.id)).toEqual(['cadence', 'prog-fill', 'prog-order', 'prog-transpose', 'prog-mode', 'prog-ear']);
    expect(prog.every((s) => s.make(seededRng(1)).kind === 'play')).toBe(true);
  });

  for (const stage of STAGES) {
    it(`${stage.id}: produces valid, reproducible questions`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const q = stage.make(seededRng(seed));
        const again = stage.make(seededRng(seed));
        expect(again.prompt).toBe(q.prompt);
        expect(JSON.stringify(again.answer)).toBe(JSON.stringify(q.answer));
        if (q.kind === 'choice') {
          expect(q.choices, q.prompt).toContain(q.answer);
          expect(new Set(q.choices).size, q.prompt).toBe(q.choices!.length);
          expect(q.choices!.length).toBeGreaterThanOrEqual(2);
        }
        if (q.kind === 'order') {
          expect([...q.items!].sort()).toEqual([...(q.answer as string[])].sort());
          expect(q.items!.join()).not.toBe((q.answer as string[]).join());
        }
        if (q.kind === 'piano') expect((q.answer as number[]).length).toBeGreaterThanOrEqual(3);
        if (q.kind === 'play') {
          expect(q.targets!.length).toBeGreaterThan(0);
          expect(q.slotLabels!.length).toBe(q.targets!.length);
          for (const t of q.targets!) expect(Chord.get(t.split('/')[0]).empty, t).toBe(false);
          // the target's own notes must count as playing it
          for (const t of q.targets!) expect(chordMatches(Chord.get(t.split('/')[0]).notes.map((n) => Note.midi(n + '4')!), t), t).toBe(true);
        }
        expect(q.explain).toBeTruthy();
      }
    });
  }
});
