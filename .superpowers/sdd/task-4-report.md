# Task 4 구현 보고

## 완료 내용

- 홈의 펌프 업무 마감 이벤트에서 작업대로 들어가 명시 날짜 메모를 남기면, 홈 14일 달력에 `일정 후보`가 표시된다.
- 후보 확인은 녹색 개인 메모 일정으로 전환되며, 되돌리기로 후보 상태를 복구한다.
- 새 업무 지시에 `다음 주까지` 같은 범위 후보가 있으면 새 업무와 후보를 만들되 홈에 남아 범위 확인 문구를 표시한다. 단일 날짜로 임의 확정하지 않는다.
- 기존 업무에 연결한 지시와 날짜가 포함된 기록·할 일은 일정 후보도 함께 저장한다. 되돌리기는 연결된 후보까지 함께 제거한다.
- 질문의 `/api/ask` 최신 요청 우선·페이지 이탈 보호와 첨부 파일 차단 동작은 기존 브라우저 계약으로 보존했다.

## 테스트

- RED: `verify-showcase-e2e.js`에서 명시 날짜 워크벤치 입력 뒤 일정 후보가 없어 실패하는 것을 확인했다.
- GREEN: `verify-showcase-e2e.js`
- `verify-home-model.js`
- `verify-home-state.js`
- `verify-home-browser.js`
- `verify-source-contract.js`
- `verify-app-data-mode-browser.js` (`$env:PRODUCT_UI_TEST_CLIENT = '1'`)

## 범위와 주의사항

- Task 5 소유인 네 가지 업무 차원 작업대 요약은 변경하지 않았다.
- Windows 환경에서 기존 8410 포트를 사용하는 로컬 서버가 있어, showcase E2E는 격리한 8947 서버를 `PRODUCT_UI_URL`로 지정해 실행했다.
