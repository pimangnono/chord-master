import { useEffect, useState } from 'react';
import { Note } from 'tonal';
import { playNotes } from '../audio/engine';
import { connectMidiHub, useMidi } from '../audio/midiHub';
import { PlayedChord, useChordInput } from '../audio/useChordInput';
import type { Question } from '../game/stages';
import { IS_ARTIFACT } from '../platform';
import { chordMatches, detectFromMidi } from '../theory/detect';
import { midiToNote, prettyChord, solfege } from '../theory/notes';
import { voiceChord } from '../theory/voicing';
import { Piano } from './Piano';

interface Props {
  q: Question;
  /** set once the question is decided; input is ignored after that */
  done: boolean;
  /** called when every slot is played (ok = no wrong attempts) or the player gives up */
  onComplete: (ok: boolean) => void;
}

/**
 * Answer by playing: the target chords are played one after another on a
 * MIDI piano, an acoustic piano (microphone) or the on-screen keys.
 */
export function PlayAnswer({ q, done, onComplete }: Props) {
  const targets = q.targets!;
  const [slot, setSlot] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [last, setLast] = useState<{ label: string; ok: boolean } | null>(null);
  const [hint, setHint] = useState(false);
  const [latch, setLatch] = useState<Set<number>>(new Set());
  const midi = useMidi();

  useEffect(() => {
    setSlot(0);
    setWrong(0);
    setLast(null);
    setHint(false);
    setLatch(new Set());
  }, [q]);

  const submit = (c: PlayedChord) => {
    if (done || slot >= targets.length) return;
    const target = targets[slot];
    if (chordMatches(c.notes, target)) {
      setLast({ label: c.label, ok: true });
      setHint(false);
      const next = slot + 1;
      setSlot(next);
      if (c.source === 'screen') playNotes(c.notes.map((m) => midiToNote(m)), 1);
      if (next >= targets.length) onComplete(wrong === 0);
    } else {
      setLast({ label: c.label, ok: false });
      setWrong((w) => w + 1);
    }
  };

  const input = useChordInput(!done, submit);

  const giveUp = () => {
    setSlot(targets.length);
    onComplete(false);
  };

  const target = targets[slot];
  const hintNotes = hint && target ? (() => {
    const v = voiceChord(target);
    return [v.bass, ...v.rh].map((n) => Note.midi(n)!);
  })() : [];
  const marks = new Map<number, 'active' | 'hint'>();
  hintNotes.forEach((m) => marks.set(m, 'hint'));
  latch.forEach((m) => marks.set(m, 'active'));

  return (
    <div className="play-answer">
      <div className="play-slots">
        {targets.map((t, i) => {
          const state = i < slot ? 'ok' : i === slot && !done ? 'now' : done ? 'shown' : '';
          return (
            <div key={i} className={`play-slot ${state}`}>
              <small>{q.slotLabels?.[i]}</small>
              <b>{i < slot || done ? prettyChord(t) : i === slot ? '♪' : ''}</b>
            </div>
          );
        })}
      </div>

      {!done && (
        <>
          <div className={`play-feedback${last ? (last.ok ? ' ok' : ' bad') : ''}`}>
            {last ? (
              last.ok ? (
                <>✔ {prettyChord(last.label)} 맞아요!</>
              ) : (
                <>
                  방금 친 코드: <b>{prettyChord(last.label)}</b> — 다시 쳐 보세요
                </>
              )
            ) : (
              <span className="muted">{slot + 1}번째 칸의 코드를 피아노로 쳐 보세요</span>
            )}
          </div>

          <div className="play-inputs">
            {midi.status === 'on' ? (
              <span className="pill ok-pill">🎹 MIDI 연결됨{midi.inputs[0] ? ` · ${midi.inputs[0]}` : ''}</span>
            ) : midi.status !== 'unsupported' ? (
              <button className="btn small" onClick={() => connectMidiHub(true)} disabled={midi.status === 'connecting'}>
                🎹 MIDI 피아노 연결
              </button>
            ) : null}
            {!IS_ARTIFACT &&
              (input.micOn ? (
                <button className="btn small ghost" onClick={input.stopMic}>
                  🎙️ 듣는 중 {input.hearing ? `· ${prettyChord(input.hearing)}` : ''} (끄기)
                </button>
              ) : (
                <button className="btn small ghost" onClick={input.startMic}>
                  🎙️ 마이크로 듣기 (어쿠스틱 피아노)
                </button>
              ))}
            {input.micOn && (
              <div className="meter">
                <div style={{ width: `${Math.round(input.level * 100)}%` }} />
              </div>
            )}
            <button className="btn small ghost" onClick={() => setHint(true)} disabled={hint}>
              💡 건반 힌트
            </button>
            <button className="btn small ghost" onClick={giveUp}>
              모르겠어요
            </button>
          </div>
          {input.micError && <p className="error small">{input.micError}</p>}
          {wrong > 0 && <p className="muted small">틀린 시도 {wrong}번 — 맞혀도 이 문제는 오답 노트에 들어가요.</p>}
        </>
      )}

      <Piano
        from={36}
        to={84}
        height={120}
        marks={marks}
        onDown={(m) => {
          if (done) return;
          setLatch((s) => {
            const n = new Set(s);
            if (n.has(m)) n.delete(m);
            else n.add(m);
            return n;
          });
        }}
      />
      {!done && (
        <div className="row gap wrap">
          <span className="muted small">화면 건반으로도 답할 수 있어요: 건반을 눌러 음을 고른 뒤 오른쪽 버튼</span>
          {latch.size > 0 && <span className="small">{[...latch].sort((a, b) => a - b).map((m) => solfege(midiToNote(m))).join(' ')}</span>}
          <button
            className="btn small"
            disabled={latch.size < 2}
            onClick={() => {
              const notes = [...latch].sort((a, b) => a - b);
              submit({ notes, label: detectFromMidi(notes)[0]?.symbol ?? notes.map((m) => midiToNote(m)).join(' '), source: 'screen' });
              setLatch(new Set());
            }}
          >
            이 코드 내기
          </button>
        </div>
      )}
    </div>
  );
}
