const LIBS = [
  ['Tone.js', 'MIT', '웹 오디오 재생·스케줄링·신디사이저', 'https://github.com/Tonejs/Tone.js'],
  ['tonejs-instruments (piano mp3)', 'MIT', '피아노 샘플 (앱에 내장)', 'https://github.com/Makefully-Studios/tonejs-instruments'],
  ['Tonal', 'MIT', '음·코드·음정·조성 이론 계산', 'https://github.com/tonaljs/tonal'],
  ['VexFlow', 'MIT', '오선보 렌더링', 'https://github.com/0xfe/vexflow'],
  ['React', 'MIT', 'UI', 'https://react.dev'],
  ['React Router', 'MIT', '페이지 이동', 'https://reactrouter.com'],
  ['Zustand', 'MIT', '상태 관리·로컬 저장', 'https://github.com/pmndrs/zustand'],
  ['Vite', 'MIT', '개발 서버·빌드', 'https://vitejs.dev'],
  ['Anthropic TypeScript SDK', 'MIT', '노래 정보 자동 찾기 (Claude API · 내 API 키 사용)', 'https://github.com/anthropics/anthropic-sdk-typescript'],
];

export function AboutPage() {
  return (
    <div className="page narrow">
      <h1>오픈소스 & 정보</h1>
      <div className="card">
        <h3>사용한 오픈소스</h3>
        <table className="analysis">
          <tbody>
            {LIBS.map(([name, license, role, url]) => (
              <tr key={name}>
                <td>
                  <a href={url} target="_blank" rel="noreferrer">
                    {name}
                  </a>
                </td>
                <td className="muted">{license}</td>
                <td>{role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>실시간 코드 인식은 어떻게 동작하나요?</h3>
        <ul className="tips">
          <li>마이크: Web Audio로 16384포인트 FFT를 구하고, 반음마다 스펙트럼 피크를 찾은 뒤 배음(하모닉) 합으로 가장 그럴듯한 음을 고르고 그 배음을 지우는 과정을 반복해 여러 음을 동시에 찾아요.</li>
          <li>찾은 음들의 크로마(12음 분포)를 코드 템플릿과 비교하고, 가장 낮은 음(베이스)을 반영해 전위·슬래시 코드까지 판별해요.</li>
          <li>MIDI: 디지털 피아노를 USB/블루투스로 연결하면 Web MIDI로 누른 건반을 정확히 받아요 (Chrome 지원).</li>
          <li>다음 코드 추천: 기능 화성 규칙(정격·변격·거짓 종지, 부속 도미넌트, 트라이톤 대리, 빌린 화음) + 앱에 수록된 진행·노래의 실제 코드 이동 통계를 합쳐 점수를 매겨요.</li>
          <li>모든 처리는 브라우저 안에서만 이뤄지며 소리는 어디에도 전송되지 않아요.</li>
        </ul>
      </div>
      <div className="card">
        <h3>데이터 저장</h3>
        <p className="muted">저장한 진행, 추가한 노래, 게임 기록은 이 브라우저에 저장되고, claude.ai 링크로 열면 내 claude.ai 계정에도 저장돼 다른 기기에서도 이어져요. 라이브러리의 “내보내기”로 JSON 백업을 만들 수 있어요.</p>
      </div>
    </div>
  );
}
