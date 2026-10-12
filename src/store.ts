import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from './data/songs';
import type { ChordEvent } from './theory/roman';

export interface SavedProgression {
  id: string;
  name: string;
  key: string;
  chords: ChordEvent[];
  bpm: number;
  rhythm: string;
  note?: string;
  source?: string;
  createdAt: number;
}

/** A missed question, kept for review. The question is regenerated from (stageId, seed). */
export interface Mistake {
  id: string;
  stageId: string;
  seed: number;
  prompt: string;
  answer: string;
  explain: string;
  /** Leitner box 1-4: higher = known better, reviewed less often */
  box: number;
  due: string;
  wrongCount: number;
  lastWrong: string;
}

export const REVIEW_INTERVALS = [0, 1, 3, 7, 14]; // days until the next review per box

export interface GameProgress {
  xp: number;
  mistakes?: Record<string, Mistake>;
  stars: Record<string, number>;
  best: Record<string, number>;
  streakDays: number;
  lastPlayed?: string;
}

interface State {
  saved: SavedProgression[];
  customSongs: Song[];
  game: GameProgress;
  /** both = 고정도 + 이동도 */
  pianoLabels: 'both' | 'solfege' | 'movable' | 'letters' | 'none';
  saveProgression: (p: Omit<SavedProgression, 'id' | 'createdAt'>) => SavedProgression;
  updateProgression: (id: string, patch: Partial<SavedProgression>) => void;
  deleteProgression: (id: string) => void;
  importProgressions: (list: SavedProgression[]) => number;
  addSong: (s: Song) => void;
  deleteSong: (id: string) => void;
  recordGame: (stageId: string, stars: number, xp: number, score: number) => void;
  recordMistake: (m: Omit<Mistake, 'id' | 'box' | 'due' | 'wrongCount' | 'lastWrong'>) => void;
  /** a review answer: right moves the item up a box (and out after box 4), wrong sends it back to box 1 */
  reviewResult: (id: string, correct: boolean) => void;
  removeMistake: (id: string) => void;
  setPianoLabels: (v: State['pianoLabels']) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export const mistakeId = (stageId: string, seed: number) => `${stageId}:${seed}`;

export function dueMistakes(game: GameProgress): Mistake[] {
  const t = today();
  return Object.values(game.mistakes ?? {})
    .filter((m) => m.due <= t)
    .sort((a, b) => a.due.localeCompare(b.due) || b.wrongCount - a.wrongCount);
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      saved: [],
      customSongs: [],
      game: { xp: 0, stars: {}, best: {}, streakDays: 0, mistakes: {} },
      pianoLabels: 'both',
      saveProgression: (p) => {
        const item: SavedProgression = { ...p, id: uid(), createdAt: Date.now() };
        set((s) => ({ saved: [item, ...s.saved] }));
        return item;
      },
      updateProgression: (id, patch) => set((s) => ({ saved: s.saved.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      deleteProgression: (id) => set((s) => ({ saved: s.saved.filter((p) => p.id !== id) })),
      importProgressions: (list) => {
        const valid = list.filter((p) => p && typeof p.name === 'string' && Array.isArray(p.chords));
        set((s) => ({ saved: [...valid.map((p) => ({ ...p, id: uid(), createdAt: p.createdAt ?? Date.now() })), ...s.saved] }));
        return valid.length;
      },
      addSong: (song) => set((s) => ({ customSongs: [song, ...s.customSongs.filter((x) => x.id !== song.id)] })),
      deleteSong: (id) => set((s) => ({ customSongs: s.customSongs.filter((x) => x.id !== id) })),
      recordGame: (stageId, stars, xp, score) =>
        set((s) => {
          const t = today();
          const last = s.game.lastPlayed;
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          const streakDays = last === t ? s.game.streakDays : last === yesterday ? s.game.streakDays + 1 : 1;
          return {
            game: {
              xp: s.game.xp + xp,
              stars: { ...s.game.stars, [stageId]: Math.max(stars, s.game.stars[stageId] ?? 0) },
              best: { ...s.game.best, [stageId]: Math.max(score, s.game.best[stageId] ?? 0) },
              streakDays,
              lastPlayed: t,
            },
          };
        }),
      setPianoLabels: (pianoLabels) => set({ pianoLabels }),
      recordMistake: (m) =>
        set((s) => {
          const id = mistakeId(m.stageId, m.seed);
          const prev = s.game.mistakes?.[id];
          const item: Mistake = { ...m, id, box: 1, due: addDays(REVIEW_INTERVALS[1]), wrongCount: (prev?.wrongCount ?? 0) + 1, lastWrong: today() };
          return { game: { ...s.game, mistakes: { ...(s.game.mistakes ?? {}), [id]: item } } };
        }),
      reviewResult: (id, correct) =>
        set((s) => {
          const all = { ...(s.game.mistakes ?? {}) };
          const m = all[id];
          if (!m) return {};
          if (!correct) all[id] = { ...m, box: 1, due: addDays(REVIEW_INTERVALS[1]), wrongCount: m.wrongCount + 1, lastWrong: today() };
          else if (m.box >= 4) delete all[id];
          else all[id] = { ...m, box: m.box + 1, due: addDays(REVIEW_INTERVALS[m.box + 1]) };
          return { game: { ...s.game, mistakes: all } };
        }),
      removeMistake: (id) =>
        set((s) => {
          const all = { ...(s.game.mistakes ?? {}) };
          delete all[id];
          return { game: { ...s.game, mistakes: all } };
        }),
    }),
    {
      name: 'chord-master',
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as Partial<State>;
        // v2 adds 이동도법; people on the old fixed-do default get both systems.
        if (version < 2 && s.pianoLabels === 'solfege') s.pianoLabels = 'both';
        return s as State;
      },
    },
  ),
);

export function levelFromXp(xp: number) {
  const level = Math.floor(Math.sqrt(xp / 50)) + 1;
  const cur = 50 * (level - 1) ** 2;
  const next = 50 * level ** 2;
  return { level, progress: (xp - cur) / (next - cur), toNext: next - xp };
}
