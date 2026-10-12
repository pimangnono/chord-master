/**
 * Runtime differences between a normal browser build and the claude.ai
 * artifact build (`vite build --mode artifact`). Inside an artifact the
 * frame blocks the microphone, Web MIDI, popups and plain downloads, and
 * offers platform capabilities through `window.claude.use()` instead.
 */
import { useStore } from './store';

export const IS_ARTIFACT = import.meta.env.MODE === 'artifact';

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

function runtime(): ClaudeRuntime | null {
  const c = (window as unknown as { claude?: ClaudeRuntime }).claude;
  return c && typeof c.use === 'function' ? c : null;
}

interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
}

/** Saves a text file: the platform download prompt in an artifact, a blob link elsewhere. */
export async function saveTextFile(filename: string, text: string): Promise<boolean> {
  const c = IS_ARTIFACT ? runtime() : null;
  if (c) {
    const downloads = (await c.use('downloads')) as { save(r: { filename: string; data: string }): Promise<unknown> } | null;
    if (!downloads) return false;
    try {
      await downloads.save({ filename, data: text });
      return true;
    } catch {
      return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

export type SyncState = 'local' | 'connecting' | 'synced' | 'error';
let syncState: SyncState = 'local';
const syncListeners = new Set<(s: SyncState) => void>();
function setSync(s: SyncState) {
  syncState = s;
  syncListeners.forEach((l) => l(s));
}
export function getSyncState() {
  return syncState;
}
export function onSyncState(l: (s: SyncState) => void) {
  syncListeners.add(l);
  return () => {
    syncListeners.delete(l);
  };
}

type Persisted = Pick<ReturnType<typeof useStore.getState>, 'saved' | 'customSongs' | 'game' | 'pianoLabels'>;
const pick = (s: ReturnType<typeof useStore.getState>): Persisted => ({ saved: s.saved, customSongs: s.customSongs, game: s.game, pianoLabels: s.pianoLabels });

/**
 * In an artifact, mirrors the persisted store into the viewer's private
 * `data/users/<id>/` document so the library follows their claude.ai
 * account across devices. localStorage stays the fast first paint.
 */
export async function startCloudSync() {
  const c = IS_ARTIFACT ? runtime() : null;
  if (!c) return;
  setSync('connecting');
  const [db, user] = (await Promise.all([c.use('db'), c.use('user')])) as [
    { collection(path: string): { doc(id: string): DocRef } } | null,
    { id(): Promise<string | null> } | null,
  ];
  const id = user ? await user.id() : null;
  if (!db || !id) return setSync('local');
  const ref = db.collection(`data/users/${id}`).doc('app');
  try {
    const snap = await ref.get();
    const remote = snap.exists ? (snap.data()?.state as string | undefined) : undefined;
    if (remote) {
      const data = JSON.parse(remote) as Partial<Persisted>;
      const local = pick(useStore.getState());
      const localIds = new Set(data.saved?.map((p) => p.id));
      useStore.setState({
        ...data,
        // keep anything saved on this device before it was ever synced
        saved: [...(data.saved ?? []), ...local.saved.filter((p) => !localIds.has(p.id))],
      });
    } else {
      await ref.set({ state: JSON.stringify(pick(useStore.getState())) });
    }
    setSync('synced');
  } catch {
    return setSync('error');
  }

  let last = JSON.stringify(pick(useStore.getState()));
  let timer: number | undefined;
  let writing = Promise.resolve();
  useStore.subscribe((s) => {
    const next = JSON.stringify(pick(s));
    if (next === last) return;
    last = next;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      writing = writing
        .then(() => ref.set({ state: next }))
        .then(() => setSync('synced'))
        .catch(() => setSync('error'));
    }, 800);
  });
}
