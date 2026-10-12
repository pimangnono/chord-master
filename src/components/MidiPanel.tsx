import { useMemo } from 'react';
import { connectMidiHub, disconnectMidiHub, setMidiSound, useMidi } from '../audio/midiHub';
import { detectFromMidi } from '../theory/detect';
import { prettyChord } from '../theory/notes';

/** Sidebar control for the app-wide MIDI connection. */
export function MidiPanel() {
  const { status, error, inputs, held, sound, audible, pedal } = useMidi();
  const chord = useMemo(() => (held.length >= 2 ? detectFromMidi(held)[0]?.symbol : undefined), [held]);
  if (status === 'unsupported') return null;
  return (
    <div className={`midi-panel ${status}`}>
      <div className="midi-head">
        <span className="midi-dot" />
        <b>MIDI 피아노</b>
        {status === 'on' && (
          <button className="link small" onClick={disconnectMidiHub} title="연결 끊기">
            끊기
          </button>
        )}
      </div>
      {status === 'off' && (
        <button className="btn small" onClick={() => connectMidiHub(true)}>
          🎹 연결하기
        </button>
      )}
      {status === 'connecting' && <span className="muted small">연결 중… 브라우저가 묻으면 “허용”을 눌러 주세요</span>}
      {status === 'error' && (
        <>
          <span className="error small">{error}</span>
          <button className="btn small ghost" onClick={() => connectMidiHub(true)}>
            다시 시도
          </button>
        </>
      )}
      {status === 'on' && (
        <>
          <span className="muted small">{inputs.length ? inputs.join(', ') : '장치를 USB/블루투스로 연결하면 자동으로 잡혀요'}</span>
          <label className="inline-check small">
            <input type="checkbox" checked={sound} onChange={(e) => setMidiSound(e.target.checked)} /> 앱 피아노 소리 내기
          </label>
          {sound && !audible && <span className="small warn-txt">화면을 한 번 클릭하면 소리가 나요</span>}
          <div className="midi-now">
            {chord ? <b>{prettyChord(chord)}</b> : <span className="muted small">{held.length ? `${held.length}음` : '건반을 눌러 보세요'}</span>}
            {pedal && <span className="pill small">페달</span>}
          </div>
        </>
      )}
    </div>
  );
}
