import type { IncomingMessage, ServerResponse } from 'node:http';
import { songLookupHandler } from './songLookupApi';
import { youtubeAudioHandler } from './youtubeAudio';

/**
 * Endpoints that exist only when the app runs on this computer
 * (`npm run dev` / `npm run preview`); the static GitHub Pages build has none.
 */
export function localApiMiddleware(env: Record<string, string>) {
  const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => unknown> = {
    'song-lookup': songLookupHandler(env.ANTHROPIC_API_KEY || undefined),
    'youtube-audio': youtubeAudioHandler(env.YTDLP_PATH || undefined),
  };
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const m = (req.url ?? '').split('?')[0].match(/\/api\/([\w-]+)$/);
    const route = m && routes[m[1]];
    if (!route) return next();
    void route(req, res);
  };
}
