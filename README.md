# 🎹 Chord Master — 코드 진행 학습 앱

재즈 · K-pop · Pop · Bossa Nova · Hip-hop · R&B의 코드 진행과 반주 리듬을 배우는 크롬 브라우저용 웹앱입니다.
피아노 소리를 실시간으로 듣고 지금 코드를 인식한 뒤, 다음에 올 수 있는 코드를 추천합니다.

## 기능

| 메뉴 | 내용 |
| --- | --- |
| 🎼 장르별 진행 | 6개 장르의 대표 진행 40여 개 · 로마숫자 분석 · 화성학 포인트 · 장르별 추천 반주 리듬. R&B는 6가지 타입(클래식 소울·모타운 / 뉴잭스윙 / 90s 슬로우잼 / 네오소울 / 가스펠 / 얼터너티브 R&B)으로 나눠 배울 수 있어요 |
| 🕰️ 시대별 진행 | 1950s ~ 2020s 타임라인, 시대를 대표하는 진행과 노래 |
| 🎵 노래로 배우기 | 곡 선택 → 코드 분석표(도수·기능·구성음) + 3단계 반주법(코드 잡기 → 기본 리듬 → 원곡 스타일) · 내 노래 직접 추가 |
| 🎙️ 실시간 코드 인식 | 마이크(어쿠스틱 피아노) / Web MIDI(디지털 피아노) / 화면·컴퓨터 키보드 입력 → 현재 코드, 도수, 조성 자동 추정, 다음 코드 추천 |
| 🎮 화성학 게임 | 11개 스테이지(계이름 → 오선보 → 이동도법 → 음정 → 메이저/마이너 → 코드 만들기 → 다이아토닉 → 7th → 종지 → 로마숫자 → 유명 진행 귀로 맞히기), 하트·별·XP·연속 학습일 |
| ♥ 내 라이브러리 | 마음에 든 진행 저장, 직접 만들기(다이아토닉/빌린 화음 팔레트 + 다음 코드 추천), JSON 내보내기/가져오기 |

모든 진행 화면에서: 조성 변경(전조), 템포, 반주 리듬 선택(20종), 드럼·왼손·오른손 on/off, **반주 악보**(음표에 마우스를 올리면 고정도·이동도 계이름 + 코드 안에서의 역할 표시, 클릭하면 소리), 16분음표 리듬 그리드, 그리고 **자리바꿈 가이드**:

- 코드마다 오른손 자리바꿈(기본형/1전위/2전위/3전위), 앞 코드와의 공통음, 손 이동 거리
- “기본형만” vs “자리바꿈” 비교 — 재생·악보에 바로 적용
- 베이스가 도약하는 곳에 슬래시 코드(예: C → G/B → Am) 제안, 클릭 한 번으로 적용

계이름은 **고정도(C=도)와 이동도(조의 으뜸음=도, 단조는 라 시작)를 함께** 보여주며, 사이드바에서 하나만 보이게 바꿀 수 있어요.

## 사이트

`.github/workflows/pages.yml`이 푸시할 때마다 테스트 → 빌드 → GitHub Pages 배포를 합니다 (저장소 Settings → Pages → Source를 **GitHub Actions**로 한 번 설정). 주소: https://pimangnono.github.io/chord-master/ — HTTPS라 마이크·MIDI 모두 동작합니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173 을 Chrome으로 열기
npm run build    # dist/ 에 정적 사이트 생성 (어느 정적 호스팅에나 배포 가능)
npm test         # 이론·인식 엔진 단위 테스트
```

마이크 사용에는 `localhost` 또는 HTTPS가 필요합니다. 피아노 샘플은 앱에 내장돼 있어 오프라인에서도 동작합니다.

`npm run build:artifact`는 claude.ai 아티팩트용 빌드(`dist-artifact/`)를 만듭니다. 아티팩트에서는 플랫폼 정책상 마이크·MIDI를 쓸 수 없어 화면/키보드 입력만 지원하고, 저장 데이터는 claude.ai 계정(db capability)에 동기화됩니다.

## 오픈소스

- [Tone.js](https://github.com/Tonejs/Tone.js) (MIT) — 오디오 재생/스케줄링
- [tonejs-instruments](https://github.com/Makefully-Studios/tonejs-instruments) piano mp3 (MIT, npm `tonejs-instrument-piano-mp3`) — 피아노 샘플, `public/samples`에 내장
- [Tonal](https://github.com/tonaljs/tonal) (MIT) — 음악 이론 계산
- [VexFlow](https://github.com/0xfe/vexflow) (MIT) — 악보 렌더링
- React, React Router, Zustand, Vite (MIT)

## 구조

```
src/
  theory/     음악 이론: 로마숫자↔코드, 보이싱, 반주 편곡, 코드 인식, 조성 추정, 다음 코드 추천
  audio/      Tone.js 엔진, 마이크 다성 음높이 추정, Web MIDI
  notation/   편곡 → 16분음표 악보 데이터
  data/       장르·시대 진행, 반주 리듬 패턴, 노래
  game/       화성학 게임 스테이지
  pages/      화면
```

마이크 인식은 FFT 스펙트럼에서 배음 합(harmonic sum)으로 가장 그럴듯한 음을 고르고 그 배음을 지우는 과정을 반복하는 방식(Klapuri 방식의 단순화)입니다. 합성 피아노 음으로 검증하는 테스트가 `src/audio/listener.test.ts`에 있습니다.

수록곡의 코드는 학습용으로 간략화한 진행이며 가사·멜로디는 포함하지 않습니다.
