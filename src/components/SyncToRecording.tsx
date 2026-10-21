import { useEffect, useRef, useState } from 'react';
import { Interval } from 'tonal';
import { syncSections, SectionSync } from '../audio/align';
import { ANALYSIS_RATE, beatFeatures, BeatFeatures, decodeAudioFile } from '../audio/songAnalysis';
import { fetchYoutubeAudio, looksLikeYoutube, YOUTUBE_HELP, YoutubeStatus, youtubeStatus } from '../audio/youtube';
import { normalizeKeyName } from '../ai/songMeta';
import { keyLabel, transposeChord } from '../theory/keys';
import { mergeRepeatLyrics } from '../theory/sheet';

interface Props {
  /** "이름: 코드" lines, as in the song form */
  sections: { name: string; chords: string }[];
  bpm: number;
  songKey: string;
  /** words per chord, per section; kept in step when repeated chords merge */
  lyrics: string[][];
  onApply: (text: string, bpm: number, key: string, lyrics: string[][]) => void;
  /** why syncing can't start yet (no chords, unknown chords) */
  blocked?: string;
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * Re-times the pasted chords from the real recording (a YouTube link through
 * the local yt-dlp, or an audio file): the chord order comes from the sheet,
 * the length of each chord from the recording.
 */
export function SyncToRecording({ sections, bpm, songKey, lyrics, onApply, blocked }: Props) {
  const [yt, setYt] = useState<YoutubeStatus | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sync: SectionSync; source: string; before: { text: string; bpm: number; key: string; lyrics: string[][] } } | null>(null);
  const cache = useRef<{ source: string; features: BeatFeatures } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    youtubeStatus().then((v) => live && setYt(v));
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, []);

  const run = async (source: string, load: (signal: AbortSignal) => Promise<ArrayBuffer | Blob>) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setError(null);
    setDone(null);
    try {
      let features = cache.current?.source === source ? cache.current.features : null;
      if (!features) {
        const audio = await load(ctl.signal);
        setBusy('음원 읽는 중…');
        const samples = await decodeAudioFile(audio);
        if (samples.length > ANALYSIS_RATE * 60 * 12) throw new Error('12분 이하의 음원만 맞출 수 있어요.');
        features = await beatFeatures(samples, ANALYSIS_RATE, (p) => setBusy(`박자 분석 중… ${Math.round(p * 100)}%`));
        cache.current = { source, features };
      }
      if (ctl.signal.aborted) return;
      setBusy('코드 맞추는 중…');
      await new Promise((r) => setTimeout(r, 0));
      const sync = syncSections(sections, features, bpm);
      if (!sync) throw new Error('코드를 읽지 못했어요. 아래 코드 칸을 확인해 주세요.');
      const before = { text: sections.map((s) => `${s.name}: ${s.chords}`).join('\n'), bpm, key: songKey, lyrics };
      const key = sync.shift ? (normalizeKeyName(transposeChord(songKey, Interval.fromSemitones(sync.shift))) ?? songKey) : songKey;
      const words = sections.map((s, i) => (lyrics[i]?.length ? mergeRepeatLyrics(s.chords, lyrics[i]) : []));
      onApply(sync.sections.map((s) => `${s.name}: ${s.chords}`).join('\n'), sync.alignment.bpm, key, words);
      setDone({ sync, source, before });
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : '맞추지 못했어요.');
    } finally {
      if (abort.current === ctl) abort.current = null;
      setBusy(null);
    }
  };

  const recheck = () => {
    setYt(null);
    youtubeStatus().then(setYt);
  };

  const fromYoutube = () => {
    if (yt !== 'ok' || blocked) return;
    if (!looksLikeYoutube(url)) return setError('유튜브 영상 링크를 넣어 주세요 (youtube.com/watch?v=… 또는 youtu.be/…).');
    setBusy('유튜브에서 음원 받는 중…');
    run(`yt:${url.trim()}`, (signal) => fetchYoutubeAudio(url, signal, (n) => setBusy(`유튜브에서 음원 받는 중… ${(n / 1048576).toFixed(1)}MB`)));
  };

  const a = done?.sync.alignment;
  return (
    <div className="import-box sync-box" id="sync-box">
      <p className="small">
        <b>🎧 원곡에 박자 맞추기</b> — 코드 순서는 위 악보 그대로 두고, 원곡을 들어서 코드마다 몇 박인지 맞춰요. 악보 키가 원곡과 다르면 원곡 키로 옮겨요.
      </p>
      <div className="row gap wrap center-y">
        <input
          id="sync-url"
          className="grow-input"
          placeholder="유튜브 링크 (https://youtu.be/…)"
          value={url}
          disabled={yt !== 'ok'}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && fromYoutube()}
        />
        <button className="btn" id="sync-youtube" disabled={yt !== 'ok' || !!busy || !!blocked || !url.trim()} onClick={fromYoutube}>
          유튜브로 맞추기
        </button>
        <button className="btn ghost" disabled={!!busy || !!blocked} onClick={() => fileRef.current?.click()}>
          음원 파일로
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) {
              setBusy('음원 읽는 중…');
              run(`file:${f.name}:${f.size}`, async () => f);
            }
          }}
        />
        {busy && (
          <button className="btn ghost small" onClick={() => abort.current?.abort()}>
            취소
          </button>
        )}
      </div>
      {yt === null && <p className="muted small">유튜브 링크를 쓸 수 있는지 확인하는 중…</p>}
      {yt && yt !== 'ok' && (
        <p className="small warn-text" id="sync-yt-help">
          {YOUTUBE_HELP[yt]}{' '}
          {yt === 'no-ytdlp' && (
            <button className="link-btn small" onClick={recheck}>
              다시 확인
            </button>
          )}
        </p>
      )}
      {blocked && <p className="muted small">{blocked}</p>}
      {busy && <p className="muted small">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {done && a && (
        <div className="lookup-result" id="sync-result">
          <p className="small">
            <span className={`tag ${a.fit > 0.5 ? 'conf-high' : a.fit > 0.3 ? 'conf-medium' : 'conf-low'}`}>일치도 {Math.round(a.fit * 100)}%</span> 코드 {a.chords.length}개의 길이를 맞췄어요 · 템포 <b>{a.bpm} BPM</b> ·
            첫 코드는 원곡 <b>{clock(a.start)}</b>부터
          </p>
          {done.sync.shift !== 0 && (
            <p className="small warn-text">
              악보가 원곡보다 {Math.abs(done.sync.shift)}반음 {done.sync.shift > 0 ? '낮게' : '높게'} 적혀 있어서 원곡 키({keyLabel(normalizeKeyName(transposeChord(done.before.key, Interval.fromSemitones(done.sync.shift))) ?? done.before.key)})로 옮겼어요.
            </p>
          )}
          {a.fit <= 0.3 && <p className="small warn-text">음원과 코드가 잘 안 맞아요. 다른 버전(라이브·커버)의 음원이거나 악보 코드 순서가 다를 수 있어요.</p>}
          <p className="muted small">원곡을 {clock(a.start)}부터 틀고 같이 재생하면 맞아요. 군데군데 어긋나면 그 코드만 아래에서 고쳐 주세요.</p>
          <div className="row gap">
            <button
              className="btn ghost small"
              onClick={() => {
                onApply(done.before.text, done.before.bpm, done.before.key, done.before.lyrics);
                setDone(null);
              }}
            >
              되돌리기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
