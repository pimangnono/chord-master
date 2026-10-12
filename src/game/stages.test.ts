import { describe, expect, it, vi } from 'vitest';

vi.mock('../audio/engine', () => ({ playNotes: vi.fn(), playSequence: vi.fn() }));

const { seededRng, STAGES } = await import('./stages');

describe('game stages', () => {
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
        expect(q.explain).toBeTruthy();
      }
    });
  }
});
