import { useMemo } from 'react';
import { playNotes } from '../audio/engine';
import { analyzeInversions, BassSuggestion } from '../theory/inversion';
import { movableDo } from '../theory/keys';
import { prettyChord, prettyNote, solfege, splitSlash } from '../theory/notes';
import type { ChordEvent } from '../theory/roman';
import type { VoicingMode } from '../theory/voicing';

export interface InversionGuideProps {
  chords: ChordEvent[];
  keyName: string;
  mode: VoicingMode;
  onModeChange: (m: VoicingMode) => void;
  suggestions: BassSuggestion[];
  applied: Record<number, string>;
  onToggleSlash: (s: BassSuggestion) => void;
  onSelect?: (index: number) => void;
}

const stepWord = (step: number) => `${Math.abs(step) === 1 ? '반음' : '온음'} ${step < 0 ? '내려가요' : '올라가요'}`;

export function InversionGuide({ chords, keyName, mode, onModeChange, suggestions, applied, onToggleSlash, onSelect }: InversionGuideProps) {
  const symbols = useMemo(() => chords.map((c) => c.symbol), [chords]);
  const a = useMemo(() => analyzeInversions(symbols), [symbols]);
  const rows = mode === 'smooth' ? a.smooth : a.root;
  const saved = a.rootTotal ? Math.round((1 - a.smoothTotal / a.rootTotal) * 100) : 0;

  return (
    <section className="card inv">
      <div className="card-head">
        <h3>🔄 자리바꿈 가이드</h3>
        <div className="seg">
          <button className={mode === 'smooth' ? 'on' : ''} onClick={() => onModeChange('smooth')}>
            자리바꿈 (부드럽게)
          </button>
          <button className={mode === 'root' ? 'on' : ''} onClick={() => onModeChange('root')}>
            기본형만
          </button>
        </div>
      </div>
      <p className="muted small">
        자리바꿈(전위)은 코드 구성음의 쌓는 순서를 바꿔 맨 아래 음을 바꾸는 것이에요. 앞 코드와 겹치는 음(공통음)은 그대로 두고 나머지만 가까운 음으로 옮기면 손 이동이 줄고 소리가 매끄러워져요. 선택한 방식이 재생·악보에 바로 적용돼요.
      </p>
      {a.rootTotal > 0 && (
        <div className="inv-summary">
          <div>
            <span className="muted small">기본형만</span>
            <b>{a.rootTotal}반음</b>
          </div>
          <span className="inv-arrow">→</span>
          <div className="good">
            <span className="muted small">자리바꿈</span>
            <b>{a.smoothTotal}반음</b>
          </div>
          <p className="small">
            오른손 손가락이 움직이는 총 거리{saved > 0 ? `가 ${saved}% 줄어요.` : '는 비슷해요.'}
          </p>
        </div>
      )}
      <div className="table-wrap">
        <table className="analysis inv-table">
          <thead>
            <tr>
              <th>코드</th>
              <th>자리바꿈</th>
              <th>오른손 (아래 → 위)</th>
              <th>앞 코드와</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                onClick={() => {
                  onSelect?.(i);
                  playNotes([r.voicing.bass, ...r.voicing.rh], 1.4);
                }}
              >
                <td>
                  <b>{prettyChord(r.symbol)}</b>
                </td>
                <td>
                  <span className={`inv-badge inv-${r.inversion.number}`}>{r.inversion.name}</span>
                  <div className="muted small">{r.inversion.detail}</div>
                </td>
                <td>
                  <div className="inv-notes">
                    {r.voicing.rh.map((n) => (
                      <span key={n} className={r.motion?.common.includes(n) ? 'held' : ''} title={prettyNote(n)}>
                        {solfege(n)}
                        <i>{movableDo(n, keyName)}</i>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="small">
                  {r.motion ? (
                    <>
                      {r.motion.common.length ? <span className="held-txt">공통음 {r.motion.common.map((n) => solfege(n)).join('·')} 유지</span> : <span className="muted">공통음 없음</span>}
                      <div className="muted">{r.motion.moved}반음 이동</div>
                    </>
                  ) : (
                    <span className="muted">시작</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">초록색 음 = 앞 코드에서 그대로 누르고 있는 공통음. 행을 클릭하면 들을 수 있어요.</p>

      <h4>베이스 자리바꿈 (슬래시 코드) 제안</h4>
      {suggestions.length === 0 ? (
        <p className="muted small">이 진행은 베이스가 이미 충분히 부드럽게 움직여요.</p>
      ) : (
        <>
          <p className="muted small">왼손 베이스에 근음 대신 3음·5음을 두면 베이스 라인이 계단처럼 이어져요. “적용”을 누르면 재생과 악보에 반영돼요.</p>
          <ul className="bass-sugg">
            {suggestions.map((s) => {
              const on = applied[s.index] === s.symbol;
              const prev = chords[s.index - 1]?.symbol ?? '';
              const prevBass = splitSlash(prev)[1] ?? prev.match(/^[A-G][#b]*/)?.[0] ?? '';
              return (
                <li key={s.index}>
                  <div>
                    <b>
                      {prettyChord(prev)} → {prettyChord(s.from)}
                    </b>{' '}
                    대신{' '}
                    <b className="accent">
                      {prettyChord(prev)} → {prettyChord(s.symbol)}
                    </b>
                    <div className="muted small">
                      베이스가 {solfege(prevBass)}에서 {solfege(s.bass)}로 {stepWord(s.step)} (원래는 {s.leap}반음 도약)
                    </div>
                  </div>
                  <button className={`chip-toggle${on ? ' on' : ''}`} onClick={() => onToggleSlash(s)}>
                    {on ? '적용됨 ✓' : '적용'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
