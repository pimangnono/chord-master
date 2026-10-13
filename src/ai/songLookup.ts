import { IS_ARTIFACT } from '../platform';
import type { GenreId } from '../data/progressions';
import { buildLookupPrompt, extractJson, LookupInput, normalizeMeta, SongMeta } from './songMeta';

/**
 * Looks up a song's genre, key, BPM and feel with Claude.
 *
 * - On the website the user brings their own Anthropic API key (kept only
 *   in this browser's localStorage) and Claude searches the web.
 * - Inside the claude.ai artifact the page asks Claude through the
 *   viewer's own account (`sample` capability) — no key, but no browsing,
 *   so answers come from what Claude knows.
 */

const KEY_STORAGE = 'chord-master-anthropic-key';
export const LOOKUP_MODEL = 'claude-opus-5-5';

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage blocked — the key just isn't remembered */
  }
}

export class LookupError extends Error {
  constructor(
    message: string,
    readonly code: 'no_key' | 'bad_key' | 'rate_limited' | 'network' | 'refused' | 'no_answer' | 'cancelled' | 'unavailable',
  ) {
    super(message);
  }
}

export interface LookupResult extends SongMeta {
  via: 'web' | 'knowledge';
}

interface SampleFn {
  (input: string, opts?: { signal?: AbortSignal; modelTier?: 'quick' | 'default' | 'complex' }): Promise<{ text: string; truncated: boolean }>;
}

async function artifactSample(): Promise<SampleFn | null> {
  const c = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (!c || typeof c.use !== 'function') return null;
  return ((await c.use('sample')) as SampleFn | null) ?? null;
}

/** Whether this build looks songs up without asking for a key. */
export const LOOKUP_NEEDS_KEY = !IS_ARTIFACT;

export async function lookupSongMeta(input: LookupInput, fallbackGenre: GenreId, signal?: AbortSignal): Promise<LookupResult> {
  // spelled out (not IS_ARTIFACT) so the artifact build drops the SDK entirely
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
  return lookupWithApi(input, fallbackGenre, signal);
}

async function lookupWithApi(input: LookupInput, fallbackGenre: GenreId, signal?: AbortSignal): Promise<LookupResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new LookupError('Anthropic API 키를 먼저 넣어 주세요.', 'no_key');
  // Loaded on demand so the SDK stays out of the main bundle.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // The key belongs to the user and only ever goes from their browser to api.anthropic.com.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  type Params = Parameters<typeof client.beta.messages.create>[0];

  const ask = async (search: boolean) => {
    const messages: Params['messages'] = [{ role: 'user', content: buildLookupPrompt(input, search) }];
    let response;
    // Web search runs server-side; a long search can pause the turn, which is resumed by sending it back.
    for (let round = 0; round < 3; round++) {
      response = await client.beta.messages.create(
        {
          model: LOOKUP_MODEL,
          max_tokens: 8000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          ...(search ? { tools: [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 5 }] } : {}),
          messages,
        },
        { signal },
      );
      if (response.stop_reason !== 'pause_turn') break;
      messages.splice(1, messages.length - 1, { role: 'assistant', content: response.content });
    }
    return response;
  };

  try {
    let response;
    try {
      response = await ask(true);
    } catch (e) {
      // an organization can switch web search off in the Console — then answer from knowledge
      if (e instanceof Anthropic.BadRequestError && /web.?search/i.test(e.message)) response = await ask(false);
      else throw e;
    }
    if (!response) throw new LookupError('답을 받지 못했어요.', 'no_answer');
    if (response.stop_reason === 'refusal') throw new LookupError('이 노래 정보는 찾아줄 수 없대요. 직접 입력해 주세요.', 'refused');

    let text = '';
    const cited = new Map<string, string>();
    const found = new Map<string, string>();
    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
        for (const c of block.citations ?? []) if (c.type === 'web_search_result_location') cited.set(c.url, c.title ?? c.url);
      } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) found.set(r.url, r.title);
      }
    }
    const raw = extractJson(text);
    if (!raw) throw new LookupError('답을 읽지 못했어요. 다시 시도해 주세요.', 'no_answer');
    const meta = normalizeMeta(raw, fallbackGenre);
    if (!meta.sources.length) {
      const pool = cited.size ? cited : found;
      meta.sources = [...pool].slice(0, 3).map(([url, title]) => ({ url, title }));
    }
    return { ...meta, via: found.size ? 'web' : 'knowledge' };
  } catch (e) {
    if (e instanceof LookupError) throw e;
    if (e instanceof Anthropic.APIUserAbortError) throw new LookupError('취소했어요.', 'cancelled');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      throw new LookupError('API 키가 맞지 않거나 권한이 없어요. 키를 다시 확인해 주세요.', 'bad_key');
    if (e instanceof Anthropic.RateLimitError) throw new LookupError('요청이 많아요. 잠시 후 다시 시도해 주세요.', 'rate_limited');
    if (e instanceof Anthropic.APIConnectionError) throw new LookupError('Anthropic 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', 'network');
    if (e instanceof Anthropic.APIError) {
      const msg = e.message.toLowerCase();
      if (msg.includes('credit') || msg.includes('billing')) throw new LookupError('API 크레딧이 부족해요. console.anthropic.com 에서 확인해 주세요.', 'bad_key');
      throw new LookupError(`찾는 중 오류가 났어요 (${e.status ?? '?'}). 잠시 후 다시 시도해 주세요.`, 'network');
    }
    throw new LookupError('찾는 중 오류가 났어요. 잠시 후 다시 시도해 주세요.', 'network');
  }
}
