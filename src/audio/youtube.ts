/**
 * Audio from a YouTube link, via the local server's yt-dlp (`npm run dev`).
 * The audio streams into memory for analysis and is never saved.
 */

const ENDPOINT = `${import.meta.env.BASE_URL}api/youtube-audio`;
const HEADERS = { 'x-chord-master': '1' };

let available: Promise<boolean> | null = null;

/** Whether this page runs on the local server with yt-dlp installed (checked once). */
export function youtubeAvailable(): Promise<boolean> {
  if (import.meta.env.MODE === 'artifact') return Promise.resolve(false);
  available ??= fetch(`${ENDPOINT}?check=1`, { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(8000) })
    .then(async (r) => r.ok && !!((await r.json()) as { available?: boolean }).available)
    .catch(() => false);
  return available;
}

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
