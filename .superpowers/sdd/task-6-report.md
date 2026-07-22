# Task 6 구현 보고서 — 회귀 검증과 시각 확인

## 결과

- `npm run test:product-ui` 전체 통과
  - source, home-model, home-state, home-browser
  - local-maintenance, fixtures, API, data-mode
  - fixture reachable flows, fixture capture, UI sync, showcase E2E
- `node --check product-ui/home-model.js` 통과
- `node --check product-ui/app.js` 통과
- `git diff --check` 통과
- `npm run capture:product-ui:home` 통과
  - 데스크톱: `1920 / 1920` — 문서 전체 가로 overflow 없음
  - 모바일: `390 / 390` — 문서 전체 가로 overflow 없음

## 시각 확인

- 데스크톱 `1920×1080`과 모바일 `390×844`에서 한글 글꼴이 정상 표시된다.
- 홈은 흰색 중심의 연한 적색 광원과 빨간 주요 행동 버튼을 유지한다.
- 14일 달력 구조가 표시되고 현재 날짜, 범례, 업무 마감 이벤트를 식별할 수 있다.
- 모바일에서는 달력 표만 카드 내부에서 가로 스크롤되고 문서 전체는 넘치지 않는다.
- 캡처는 저장 상태를 초기화한 fixture 첫 화면이므로 일정 밀도는 낮지만, 실제 엔진 없이도 사실적인 `시연용 샘플 데이터` 모드로 재현된다.
- live/auto 모드 표시 로직은 변경하지 않았다.

## Windows 테스트 진단

초기 전체 테스트 중 Git 자식 프로세스가 `0xC0000142`로 한 번 종료됐고, 재현 과정에서 동기화 테스트가 중복 실행되자 CLI의 60초 제한을 넘겨 `spawnSync.status === null`이 되는 현상을 확인했다. 테스트 전용으로 남은 프로세스 트리만 종료한 뒤 동기화 테스트를 단독 실행하자 `UI sync hardened contract passed`로 통과했고, 전체 테스트를 한 번만 직렬 실행했을 때도 동일하게 통과했다. 제품 코드나 동기화 검증을 약화하는 수정은 하지 않았다.

## 변경 파일

- `package.json`
  - Windows에서도 동작하는 data-mode 브라우저 테스트 실행 방식 적용
  - 실제 유지보수 회귀 테스트를 전체 체인에 포함
  - 홈 캡처 명령 추가
- `tools/capture-home-two-week-context.js`
  - fixture 홈의 데스크톱·모바일 결정적 캡처와 overflow 검증
  - 전용 8410 포트 사용 및 종료 시 서버 정리
- `product-ui/screenshots/home-two-week-context.png`
  - 확정 홈의 데스크톱 검증 캡처
- `product-ui/screenshots/showcase-golden.png`
  - 최신 시연 흐름의 E2E 기준 캡처

## 남은 참고사항

- Git의 LF→CRLF 메시지는 Windows 작업 트리 줄바꿈 경고이며 테스트 실패가 아니다.
- 사용자 데모 서버가 사용하는 8400 포트는 건드리지 않았고, 캡처용 8410 포트는 실행 후 해제됐다.

## 전체 코드 리뷰 후 보완

- `무엇을 만들어야 하는가`는 임의의 초안 필드나 완료 조건을 산출물 이름으로 사용하지 않는다.
  - 근거가 없으면 `확인 필요`
  - 저장된 초안이 있으면 내용 대신 `저장된 초안 있음`으로 사실만 표시
- 홈에서도 `시연용 샘플 데이터`, `실제 엔진 연결`, `엔진 연결 오류` 상태가 눈에 보이도록 배지를 추가했다.
- 주 입력 카드에 키보드 `focus-within` 링을 추가했다.
- 작은 빨간 텍스트는 대비 4.5:1 이상인 진한 빨간색을 사용하도록 변경했다.
- 공사 일정의 분홍 그라데이션 위 글자와 데스크톱 레일 hover 상태까지 대비 검증 범위에 포함했다.
- 각 변경은 실패하는 브라우저 테스트를 먼저 확인한 뒤 통과시켰고, 홈·데이터 모드·쇼케이스 E2E를 함께 재검증했다.
