# UI·UX 정본과 직무 메모리 엔진의 쇼케이스 통합 설계

> 확정일: 2026-07-21  
> 대상 저장소: `sangwonMoon-kor/kdhc-ai-contest`, `creationy/jikmu-memory`  
> 상태: 사용자 승인 완료  
> 목적: UI·UX 정본과 실제 온톨로지 엔진을 하나의 발표용 제품 경험으로 결합한다.

## 1. 배경

두 저장소는 같은 제품을 서로 다른 관점에서 발전시켰다.

- `kdhc-ai-contest`는 발표 서사, 시각 설계, 모션, 문구, 업무 작업대 프로토타입을 담당한다.
- `jikmu-memory`는 문서 파싱, OKF 온톨로지, 근거 기반 질의, 브리핑·예보·초안·점검 API, Vercel 배포를 담당한다.

최종 발표에서는 두 결과물을 따로 보여주지 않는다. 임직원이 하나의 제품을 보고 공감과 놀람을 느끼는 것이 우선이며, 발표 시연은 사전에 녹화한 영상으로 진행한다. 따라서 실서비스 수준의 모든 예외·권한·영속화를 완성하는 대신, 영상에서 사용하는 대표 업무 흐름은 높은 완성도와 기술적 근거를 함께 가져야 한다.

## 2. 목표와 비목표

### 목표

1. 최종 사용자는 하나의 화면과 하나의 업무 흐름만 경험한다.
2. `kdhc-ai-contest`에는 최신 UI·UX 원본과 디자인 의사결정이 남는다.
3. `jikmu-memory`에는 최신 UI와 실제 엔진이 결합된 실행본이 남는다.
4. 맥미니에서 백엔드를 실행하지 않아도 고정 데이터로 UI를 수정하고 녹화 동선을 검증할 수 있다.
5. 실제 엔진 연결 시 같은 화면이 `/api/*` 응답을 사용한다.
6. UI 동기화 출처와 버전을 커밋 단위로 추적한다.

### 비목표

- 인증·RBAC·조직별 권한 구현
- 모든 업무 상태의 서버 영속화
- 실제 회사 문서의 외부 LLM 전송
- 두 저장소의 Git 이력 병합
- 발표 영상에 사용하지 않는 관리자 기능의 전면 재설계
- 이번 통합 직후 두 저장소의 `main` 직접 수정

## 3. 정본과 저장소 역할

정본은 계층별로 구분한다.

| 계층 | 정본 저장소 | 역할 |
|---|---|---|
| UI·UX | `kdhc-ai-contest/product-ui/` | 화면 구조, 디자인 토큰, 모션, 문구, fixture, 영상 동선 |
| 실행 제품 | `jikmu-memory/service/public/` | 동기화된 UI와 실제 API·온톨로지 엔진의 결합 |
| 백엔드 | `jikmu-memory/service/src/`, `service/server.js` | 파싱, 그래프, 기능 도출, 질의, 영속화, LLM 보강 |
| 발표 자료 | `kdhc-ai-contest/demo/`, `docs/` | 기존 프로토타입, 발표 슬라이드, 대본, 설계 기록 |

통합 초기에는 `jikmu-memory/main@13e232e`의 `service/public/`을 `product-ui/`의 기술 기준으로 한 번 가져온다. 이후 `demo/app.html`에서 확정한 시각 언어와 연출을 선별적으로 이식한다. 초기 기준선 생성 이후 UI 변경 방향은 항상 다음과 같다.

```text
kdhc-ai-contest/product-ui
  → 검증·버전 확정
  → jikmu-memory의 ui/showcase-integration 브랜치
  → service/public
```

팀원 저장소에서 발견한 UI 버그는 `service/public`만 직접 고쳐 장기 유지하지 않는다. 긴급 수정 후 같은 변경을 `product-ui`에 먼저 반영하거나 즉시 역반영하여 다음 동기화가 수정사항을 덮어쓰지 않게 한다.

## 4. 브랜치 전략

### UI 저장소

- 설계 문서: `design/ui-backend-integration`
- 구현: 설계 검토 후 `feature/product-ui-source`
- UI 버전 확정 시 `ui-vX.Y.Z` 태그 사용

### 엔진 저장소

- 통합: 최신 `main`에서 `ui/showcase-integration` 생성
- 팀원 백엔드 변경을 받을 때는 통합 브랜치에서 `origin/main`을 병합한다.
- 검증 전 `main` 직접 푸시 금지
- 최종 병합은 PR로 수행

## 5. UI 파일 구조

```text
product-ui/
  index.html
  style.css
  app.js
  api-client.js
  intent.js
  extract.js
  assets/
  fixtures/
    manifest.json
    summary.json
    briefing.json
    forecast.json
    documents/
    ask/
    draft/
    check/
  sync-manifest.json
```

- `app.js`는 화면 상태와 상호작용을 담당한다.
- `api-client.js`는 데이터 출처를 감추고 UI에 동일한 응답 형태를 제공한다.
- `intent.js`는 현재 결정론적 의도 분류 계약을 유지한다.
- `extract.js`는 HWP/PDF 로컬 추출 기능을 유지한다.
- `fixtures/manifest.json`은 데이터 버전, 원본 엔진 커밋, 추출 시각, API 계약 버전을 기록한다.
- `sync-manifest.json`은 팀원 저장소로 복사할 허용 파일만 명시한다.

## 6. 데이터 모드와 API 계약

### 모드

| 모드 | 용도 | 동작 |
|---|---|---|
| `fixture` | 맥미니 UI 개발, 영상 녹화 | 저장된 v2.4 샘플 응답만 사용 |
| `live` | 실제 엔진 검증 | 같은 출처의 `/api/*` 호출, 실패를 숨기지 않음 |
| `auto` | 일반 통합 실행 | API가 정상이면 live, 초기 연결 실패 시 fixture로 복귀 |

모드는 URL의 `?data=fixture`, `?data=live`, `?data=auto`로 명시한다. 영상 녹화 주소는 `fixture`를 기본으로 고정해 네트워크·LLM 지연이 장면을 바꾸지 않게 한다. 기술 검증과 Q&A용 실행은 `live`를 사용한다.

### 1차 통합 API

| 경험 | 실제 엔드포인트 |
|---|---|
| 서비스·인물·통계 | `GET /api/summary` |
| 업무 목록·달력 | `GET /api/forecast` |
| 브리핑·근거 | `GET /api/briefing` |
| 문서·근거 서랍 | `GET /api/documents`, `GET /api/documents/:id`, `GET /api/okf/:id` |
| 자연어 질문 | `POST /api/ask` |
| 기안 초안 | `POST /api/draft` |
| 제출 전 점검 | `POST /api/check` |

Todo, 진행 기록, 기안 임시 저장과 영상용 상태 변화는 현재처럼 브라우저 상태로 유지한다. 인제스트·힌트·초기화 API는 기존 기능을 보존하지만 1차 영상의 핵심 동선에는 넣지 않는다.

### 계약 원칙

1. UI는 API 원응답을 화면 곳곳에서 직접 해석하지 않고 `api-client.js`의 정규화 결과만 사용한다.
2. fixture와 live는 동일한 정규화 결과를 반환한다.
3. 응답에 없는 날짜·금액·문서번호를 UI가 임의 생성하지 않는다.
4. 브라우저에 LLM 키, KV 토큰, 관리자 비밀정보를 넣지 않는다.
5. fixture에는 각색된 PoC 샘플 데이터만 저장한다.

## 7. 동기화 방식

두 저장소를 submodule이나 subtree로 결합하지 않는다. 발표 직전의 배포 복잡성과 저장소 권한 의존을 줄이기 위해, 허용 목록 기반 Node 동기화 도구를 사용한다.

예상 인터페이스:

```bash
node tools/sync-product-ui.js --target /path/to/jikmu-memory --check
node tools/sync-product-ui.js --target /path/to/jikmu-memory --write
```

동기화 도구는 다음을 강제한다.

1. 대상 원격이 `creationy/jikmu-memory`인지 확인한다.
2. 대상 브랜치가 `ui/`로 시작하는지 확인한다.
3. 대상 작업 트리가 깨끗한지 확인한다.
4. `sync-manifest.json`에 있는 파일만 `service/public/`에 복사한다.
5. 매니페스트 밖 파일과 `service/src/`는 수정·삭제하지 않는다.
6. `.ui-source.json`에 UI 저장소 커밋 SHA와 UI 버전을 기록한다.
7. `--check`는 파일을 쓰지 않고 차이만 보고한다.

자동 cross-repository push와 개인 토큰 기반 GitHub Action은 1차 범위에서 제외한다. 맥미니에서 두 저장소를 나란히 체크아웃하고 명시적으로 동기화·검증·커밋하는 흐름이 더 투명하다.

## 8. 대표 영상 시나리오

영상은 순환수 펌프 정비공사 한 건을 처음부터 끝까지 따라간다.

1. 홈에서 `팀장님이 다음 주까지 펌프 정비계획 올리래`를 입력한다.
2. 시스템이 기존 반복 업무와 연결해 업무 작업대를 연다.
3. 작업대에서 지금 할 일, 작년 서식, 산출근거와 과거 주의 이력을 함께 보여준다.
4. `작년 펌프 정비 추진 보고 찾아줘`라고 묻고 근거가 붙은 답변을 확인한다.
5. 작년 문서 구조를 바탕으로 올해 기안 초안을 연다.
6. 제출 전 점검에서 산출근거 누락·특정 모델 지정 등 과거 반려·감사 위험을 찾는다.
7. 진행 기록과 완료 결과가 다음 담당자의 브리핑북으로 남는 장면으로 끝낸다.

감정 흐름은 `낯섦 → 안심 → 놀람 → 보호받는 느낌 → 조직에 남는 가치`로 설계한다. 그래프 노드 수나 모델명을 전면에 내세우지 않고, 근거 버튼과 자연스러운 결과를 통해 기술의 존재를 보여준다.

## 9. 오류 처리와 녹화 안정성

- `fixture` 모드에서는 외부 네트워크를 호출하지 않는다.
- `live` 모드는 API 오류를 개발용 상태 패널에 표시하고 자동으로 결과를 위조하지 않는다.
- `auto` 모드는 최초 연결 실패 시 fixture로 복귀하고 `시연용 샘플 데이터` 표시를 유지한다.
- 응답 계약 버전이 맞지 않으면 live 응답을 적용하지 않고 명확한 계약 오류를 남긴다.
- 오래 걸린 `/api/ask` 응답은 더 최근 입력이나 화면 상태를 덮어쓰지 못한다.
- 영상용 `샘플 초기화`는 브라우저 상태와 시나리오 진행만 초기화하며 서버 `/api/reset`을 호출하지 않는다.
- 무효 업무 ID와 존재하지 않는 fixture는 다른 업무로 조용히 치환하지 않는다.

## 10. 검증 전략

### UI 저장소

- fixture 필수 파일과 API 계약 버전 검사
- `api-client.js`의 fixture/live 정규화 결과 동등성 테스트
- 1920×1080 대표 영상 동선 E2E
- 390px 가로 오버플로·기본 탐색 회귀
- 콘솔 오류와 실패한 리소스 요청 0건
- 기존 발표·프로토타입 파일 회귀 확인

### 엔진 저장소

- `cd service && npm test` — 현재 기준 102/102
- `sync-product-ui --check` 결과 0차이
- 통합 UI에서 `/api/summary`, `/forecast`, `/briefing`, `/ask`, `/draft`, `/check` 스모크
- fixture와 live의 핵심 화면 구조 비교
- `git diff --check`

### 최종 녹화 전

1. UI 태그와 `.ui-source.json` 일치 확인
2. fixture v2.4와 대표 문구 확인
3. 영상용 초기화 후 전체 동선 2회 연속 재현
4. 화면 해상도 1920×1080, 브라우저 배율 100%, 알림·개인정보 노출 차단
5. 녹화본에서 로딩 지연, 커서 실수, 잘린 카드, 임시 문구가 없는지 검수

## 11. 구현 순서

1. 두 저장소에 작업 브랜치를 준비한다.
2. `service/public/`을 `product-ui/`의 최초 기준선으로 가져온다.
3. fixture 데이터와 `api-client.js` 경계를 만든다.
4. 기존 동작을 유지한 채 `demo/app.html`의 시각·모션·문구를 단계별로 이식한다.
5. 대표 영상 동선을 먼저 완성한다.
6. 동기화 도구로 팀원 저장소 통합 브랜치에 반영한다.
7. 실제 API 연결, 엔진 테스트, 영상 E2E를 통과시킨다.
8. UI 버전을 태그하고 최종 영상을 녹화한다.
9. 팀원 검토 후 통합 브랜치를 PR로 `main`에 병합한다.

## 12. 인수 조건

- 임직원에게 하나의 제품·하나의 업무 흐름으로 보인다.
- 맥미니에서 엔진 없이 fixture 모드로 UI를 수정하고 대표 동선을 실행할 수 있다.
- 같은 UI가 팀원 저장소에서 실제 API를 사용한다.
- 개인 저장소의 UI 커밋과 팀원 저장소 실행본의 출처를 추적할 수 있다.
- UI 동기화가 백엔드 파일을 수정하지 않는다.
- fixture 실패나 API 실패가 빈 화면으로 이어지지 않는다.
- 대표 영상 동선이 초기화 후 반복 재현된다.
- 엔진 테스트 102/102와 UI E2E가 통과한다.
- 두 저장소의 `main`은 검증과 PR 승인 전까지 변경되지 않는다.

