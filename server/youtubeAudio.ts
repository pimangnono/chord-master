import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * `/api/youtube-audio` on the local dev/preview server: streams a YouTube
 * video's audio track through yt-dlp straight into the response, for the
 * in-browser beat analysis. Nothing is written to disk (`-o -`), and the
 * download stops as soon as the page stops reading.
 *
 *   GET ?check=1    → { available, version }
 *   GET ?url=<link> → audio bytes (m4a/webm), or { error } JSON
 *
 * yt-dlp must be installed (`brew install yt-dlp`); YTDLP_PATH in .env can
 * point at a specific binary.
 */

const MAX_BYTES = 60 * 1024 * 1024;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

/** Only plain YouTube video links (no playlists, no other sites) are passed to yt-dlp. */
export function youtubeVideoUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!YT_HOSTS.has(u.hostname)) return null;
  const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.pathname.startsWith('/shorts/') ? u.pathname.slice(8) : u.searchParams.get('v');
  if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

function run(bin: string, args: string[]) {
  // arguments go straight to the program — no shell, so nothing in a URL is interpreted
  return spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

export function youtubeAudioHandler(ytdlpPath = 'yt-dlp') {
  return (req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(body));
    };
    // A custom header means other sites can't trigger downloads (it needs a CORS preflight this server never grants).
    if (req.method !== 'GET' || req.headers['x-chord-master'] !== '1') return json(403, { error: { code: 'forbidden', message: '이 앱에서만 쓸 수 있어요.' } });

    const params = new URL(req.url ?? '', 'http://localhost').searchParams;
    if (params.has('check')) {
      const p = run(ytdlpPath, ['--version']);
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('error', () => json(200, { available: false }));
      p.on('close', (code) => !res.writableEnded && json(200, code === 0 ? { available: true, version: out.trim() } : { available: false }));
      return;
    }

    const url = youtubeVideoUrl(params.get('url') ?? '');
    if (!url) return json(400, { error: { code: 'bad_url', message: '유튜브 영상 링크가 아니에요.' } });

    const p = run(ytdlpPath, [
      '--no-playlist',
      '--quiet',
      '--no-progress',
      // m4a (AAC) or webm (Opus) — both decode in Chrome, so no ffmpeg conversion is needed
      '-f',
      'bestaudio[ext=m4a]/bestaudio',
      '--match-filters',
      'duration <= 720',
      '--max-filesize',
      '60M',
      // YouTube needs a JavaScript runtime; Node is already here for npm
      '--js-runtimes',
      'node',
      '--remote-components',
      'ejs:github',
      '-o',
      '-',
      '--',
      url,
    ]);
    let started = false;
    let bytes = 0;
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    p.stdout.on('data', (chunk: Buffer) => {
      if (!started) {
        started = true;
        res.statusCode = 200;
        res.setHeader('content-type', 'application/octet-stream');
        res.setHeader('cache-control', 'no-store');
      }
      bytes += chunk.length;
      if (bytes > MAX_BYTES) {
        p.kill();
        res.destroy();
        return;
      }
      if (!res.write(chunk)) {
        p.stdout.pause();
        res.once('drain', () => p.stdout.resume());
      }
    });
    p.on('error', () => {
      if (!res.writableEnded) json(500, { error: { code: 'no_ytdlp', message: 'yt-dlp가 설치돼 있지 않아요. 터미널에서 brew install yt-dlp 로 설치해 주세요.' } });
    });
    p.on('close', (code) => {
      if (res.writableEnded || res.destroyed) return;
      if (started && code === 0) return res.end();
      if (started) return res.destroy();
      const msg = /does not pass filter|duration/i.test(err)
        ? '12분 이하의 영상만 분석할 수 있어요.'
        : /Sign in|age|private|unavailable|not available/i.test(err)
          ? '이 영상은 받을 수 없어요 (비공개·연령 제한·지역 제한). 다른 영상 링크를 써 보세요.'
          : `yt-dlp가 음원을 가져오지 못했어요. 터미널에서 yt-dlp -U 로 업데이트해 보세요. (${err.trim().split('\n').pop()?.slice(0, 160) ?? code})`;
      json(502, { error: { code: 'ytdlp_failed', message: msg } });
    });
    // the page stopped listening (cancelled or navigated away): stop downloading
    res.on('close', () => {
      if (p.exitCode === null) p.kill();
    });
  };
}
