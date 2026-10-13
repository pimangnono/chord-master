import type { GenreId } from '../data/progressions';
import { buildLookupPrompt, extractJson, LookupError, LookupErrorCode, LookupInput, LookupResult, normalizeMeta } from './songMeta';

export { LookupError } from './songMeta';
export type { LookupResult } from './songMeta';

/**
 * Looks up a song's genre, key, BPM and feel with Claude.
 *
 * - Run locally (`npm run dev` / `npm run preview`), the page asks the local
 *   server's `/api/song-lookup`, which holds ANTHROPIC_API_KEY from `.env`
 *   and searches the web. The browser never sees the key.
 * - Inside the claude.ai artifact the page asks Claude through the
 *   viewer's own account (`sample` capability) — no key, but no browsing,
 *   so answers come from what Claude knows.
 * - The static GitHub Pages site has neither, so the button explains how
 *   to run it locally.
 */

// An earlier version kept a typed-in key in localStorage; remove any copy left behind.
try {
  localStorage.removeItem('chord-master-anthropic-key');
} catch {
  /* storage blocked — nothing to clean up */
}

const ENDPOINT = `${import.meta.env.BASE_URL}api/song-lookup`;

export type LookupMode = 'server' | 'artifact' | 'none';

let modePromise: Promise<LookupMode> | null = null;

/** Which way this page can look songs up (checked once per page load). */
export function lookupMode(): Promise<LookupMode> {
  if (import.meta.env.MODE === 'artifact') return Promise.resolve('artifact');
  modePromise ??= fetch(ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    .then(async (r) => (r.ok && ((await r.json()) as { available?: boolean }).available ? 'server' : 'none'))
    .catch(() => 'none' as const);
  return modePromise;
}

interface SampleFn {
  (input: string, opts?: { signal?: AbortSignal; modelTier?: 'quick' | 'default' | 'complex' }): Promise<{ text: string; truncated: boolean }>;
}

async function artifactSample(): Promise<SampleFn | null> {
  const c = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (!c || typeof c.use !== 'function') return null;
  return ((await c.use('sample')) as SampleFn | null) ?? null;
}

export async function lookupSongMeta(input: LookupInput, fallbackGenre: GenreId, signal?: AbortSignal): Promise<LookupResult> {
  if (import.meta.env.MODE === 'artifact') {
    const sample = await artifactSample();
    if (!sample) throw new LookupError('이 화면에서는 Claude에게 물어볼 수 없어요.', 'unavailable');
    let text: string;
    try {
      ({ text } = await sample(buildLookupPrompt(input, false), { signal, modelTier: 'default' }));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'cancelled') throw new LookupError('취소했어요.', 'cancelled');
      if (code === 'not_granted') throw new LookupError('Claude 사용을 허용해야 찾아볼 수 있어요.', 'unavailable');
      if (code === 'rate_limited') throw new LookupError('잠시 후 다시 시도해 주세요.', 'rate_limited');
      throw new LookupError('Claude에게 물어보지 못했어요. 잠시 후 다시 시도해 주세요.', 'network');
    }
    const raw = extractJson(text);
    if (!raw) throw new LookupError('답을 읽지 못했어요. 다시 시도해 주세요.', 'no_answer');
    return { ...normalizeMeta(raw, fallbackGenre), via: 'knowledge' };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, genre: fallbackGenre }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new LookupError('취소했어요.', 'cancelled');
    throw new LookupError('로컬 서버에 연결하지 못했어요. npm run dev가 켜져 있는지 확인해 주세요.', 'network');
  }
  const body = (await res.json().catch(() => null)) as (LookupResult & { error?: { code: LookupErrorCode; message: string } }) | null;
  if (!res.ok || !body || body.error) throw new LookupError(body?.error?.message ?? `찾는 중 오류가 났어요 (${res.status}).`, body?.error?.code ?? 'network');
  return body;
}
