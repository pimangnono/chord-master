import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { GENRES, GenreId } from '../src/data/progressions';
import { LookupError } from '../src/ai/songMeta';
import { lookupWithClaude } from './claudeLookup';

/**
 * `/api/song-lookup` on the local dev/preview server. The Anthropic key is
 * read from `.env` (ANTHROPIC_API_KEY — no VITE_ prefix, so Vite never
 * hands it to the browser) and used only here, in Node.
 *
 *   GET  → { available: boolean }
 *   POST { title, artist, chords, genre } → LookupResult | { error: { code, message } }
 */
export function songLookupApi(apiKey: string | undefined): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.endsWith('/api/song-lookup')) return next();
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET') return send(200, { available: !!apiKey });
    if (req.method !== 'POST') return send(405, { error: { code: 'unavailable', message: 'POST only' } });

    // Only this app may spend the key: a JSON body forces a CORS preflight for
    // other sites (which this endpoint never answers), and a foreign Origin is refused.
    const origin = req.headers.origin;
    if (!String(req.headers['content-type']).startsWith('application/json') || (origin && new URL(origin).host !== req.headers.host))
      return send(403, { error: { code: 'unavailable', message: '이 앱에서만 쓸 수 있어요.' } });
    if (!apiKey) return send(503, { error: { code: 'no_key', message: '.env에 ANTHROPIC_API_KEY가 없어요.' } });

    let body: { title?: unknown; artist?: unknown; chords?: unknown; genre?: unknown };
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64_000) throw new Error('too large');
      }
      body = JSON.parse(raw);
    } catch {
      return send(400, { error: { code: 'no_answer', message: '요청을 읽지 못했어요.' } });
    }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    if (!title) return send(400, { error: { code: 'no_answer', message: '제목이 없어요.' } });
    const artist = typeof body.artist === 'string' ? body.artist.trim().slice(0, 200) : '';
    const chords = Array.isArray(body.chords) ? body.chords.filter((c): c is string => typeof c === 'string' && c.length < 24).slice(0, 64) : [];
    const genre = GENRES.some((g) => g.id === body.genre) ? (body.genre as GenreId) : 'pop';

    // stop paying for the answer when the user cancels (the browser closes the request)
    const ctl = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ctl.abort();
    });
    try {
      send(200, await lookupWithClaude(apiKey, { title, artist, chords }, genre, ctl.signal));
    } catch (e) {
      const err = e instanceof LookupError ? e : new LookupError('찾는 중 오류가 났어요.', 'network');
      if (!res.writableEnded && !ctl.signal.aborted) send(502, { error: { code: err.code, message: err.message } });
    }
  };

  return {
    name: 'song-lookup-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
