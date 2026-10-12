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

export interface GameProgress {
  xp: number;
  stars: Record<string, number>;
  best: Record<string, number>;
  streakDays: number;
  lastPlayed?: string;
}

interface State {
  saved: SavedProgression[];
  customSongs: Song[];
  game: GameProgress;
  pianoLabels: 'solfege' | 'letters' | 'none';
  saveProgression: (p: Omit<SavedProgression, 'id' | 'createdAt'>) => SavedProgression;
  updateProgression: (id: string, patch: Partial<SavedProgression>) => void;
  deleteProgression: (id: string) => void;
  importProgressions: (list: SavedProgression[]) => number;
  addSong: (s: Song) => void;
  deleteSong: (id: string) => void;
  recordGame: (stageId: string, stars: number, xp: number, score: number) => void;
  setPianoLabels: (v: State['pianoLabels']) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function today() {
  return new Date().toISOString().slice(0, 10);
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      saved: [],
      customSongs: [],
      game: { xp: 0, stars: {}, best: {}, streakDays: 0 },
      pianoLabels: 'solfege',
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
    }),
    { name: 'chord-master', version: 1 },
  ),
);

export function levelFromXp(xp: number) {
  const level = Math.floor(Math.sqrt(xp / 50)) + 1;
  const cur = 50 * (level - 1) ** 2;
  const next = 50 * level ** 2;
  return { level, progress: (xp - cur) / (next - cur), toNext: next - xp };
}
