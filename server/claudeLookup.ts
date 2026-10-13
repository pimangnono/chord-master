import Anthropic from '@anthropic-ai/sdk';
import type { GenreId } from '../src/data/progressions';
import { buildLookupPrompt, extractJson, LookupError, LookupInput, LookupResult, normalizeMeta } from '../src/ai/songMeta';

/**
 * Server-side half of the song lookup: runs in Node (the local Vite
 * server), holds the API key from `.env`, and asks Claude — with web
 * search — for a song's genre, key, BPM and feel. The key never leaves
 * this process.
 */

export const LOOKUP_MODEL = 'claude-opus-5-5';

export async function lookupWithClaude(apiKey: string, input: LookupInput, fallbackGenre: GenreId, signal?: AbortSignal): Promise<LookupResult> {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
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
      throw new LookupError('.env의 ANTHROPIC_API_KEY가 맞지 않거나 권한이 없어요. 키를 확인하고 서버를 다시 켜 주세요.', 'bad_key');
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
