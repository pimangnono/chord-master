/**
 * Audio from a YouTube link, via the local server's yt-dlp (`npm run dev`).
 * The audio streams into memory for analysis and is never saved.
 */

const ENDPOINT = `${import.meta.env.BASE_URL}api/youtube-audio`;
const HEADERS = { 'x-chord-master': '1' };

/**
 * - `ok`: local server with yt-dlp
 * - `no-ytdlp`: local server, but yt-dlp isn't installed (or wasn't found)
 * - `no-server`: a static copy (GitHub Pages, claude.ai) with no local server
 */
export type YoutubeStatus = 'ok' | 'no-ytdlp' | 'no-server';

/** Asks the local server whether YouTube links can be used. Not cached: installing yt-dlp takes effect on the next check. */
export async function youtubeStatus(): Promise<YoutubeStatus> {
  if (import.meta.env.MODE === 'artifact') return 'no-server';
  try {
    const r = await fetch(`${ENDPOINT}?check=1`, { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return 'no-server';
    return ((await r.json()) as { available?: boolean }).available ? 'ok' : 'no-ytdlp';
  } catch {
    return 'no-server';
  }
}

/** Why a YouTube link can't be used here, for the form. */
export const YOUTUBE_HELP: Record<Exclude<YoutubeStatus, 'ok'>, string> = {
  'no-server': '유튜브 링크는 내 컴퓨터에서 npm run dev 로 연 앱에서만 쓸 수 있어요 (이 사이트에는 서버가 없어요). 여기서는 음원 파일로 맞출 수 있어요.',
  'no-ytdlp': 'yt-dlp가 설치돼 있지 않아요. 터미널에서 brew install yt-dlp 를 실행한 뒤 [다시 확인]을 누르세요.',
};

export function looksLikeYoutube(url: string): boolean {
  return /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com\/(watch\?|shorts\/)|youtu\.be\/)/i.test(url.trim());
}

/** Downloads the audio track into memory; `onBytes` reports progress. */
export async function fetchYoutubeAudio(url: string, signal?: AbortSignal, onBytes?: (n: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(`${ENDPOINT}?url=${encodeURIComponent(url.trim())}`, { headers: HEADERS, cache: 'no-store', signal });
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('json')) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `유튜브 음원을 가져오지 못했어요 (${res.status}).`);
  }
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    onBytes?.(n);
  }
  if (!n) throw new Error('받은 음원이 비어 있어요. 다른 링크를 써 보세요.');
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out.buffer;
}
