# 직무 메모리 Product UI

이 폴더가 UI·UX 정본이다. `demo/`는 발표·과거 프로토타입 보존본이며 최종 엔진 UI를 직접 수정하는 위치가 아니다.

## 맥미니에서 UI 작업

```bash
npm ci --ignore-scripts
npm run product-ui:serve
# http://127.0.0.1:8410/?data=fixture#home
```

## 데이터 모드

- `?data=fixture`: v2.4 고정 샘플, 외부 네트워크 없음
- `?data=live`: 같은 출처의 실제 `/api/*`, 실패를 숨기지 않음
- `?data=auto`: 실제 API 최초 연결 실패 시 fixture로 복귀

## 검증

```bash
npm run test:product-ui
```

## 팀원 저장소로 동기화

대상은 반드시 `creationy/jikmu-memory`의 깨끗한 `ui/*` 브랜치여야 한다.

```bash
node tools/sync-product-ui.js --target /path/to/jikmu-memory --check
node tools/sync-product-ui.js --target /path/to/jikmu-memory --write
```

`--check`는 파일을 쓰지 않는다. `changed=true`면 변경 내용을 검토한 뒤에만 `--write`하고,
팀원 저장소에서 테스트·커밋한다. 두 저장소의 `main`에는 직접 push하지 않는다.
검사는 실행 시점의 상태만 보장하므로 `--write` 직전에 다시 실행한다. 현재 두 저장소에는
submodule이 없으며, 향후 추가하면 내부 작업 트리의 clean 상태도 별도로 확인해야 한다.

프로세스 강제 종료로 `.git/jikmu-product-ui-sync.lock`이나 `.ui-sync-*`가 남으면 자동 삭제하지 않는다.
실행 중인 동기화 프로세스가 없는지와 양쪽 저장소가 clean인지 먼저 확인한 뒤 수동 검토한다.

## 팀원 엔진에서 fixture 다시 받기

팀원 엔진의 데이터나 응답 계약이 바뀌었을 때만 재캡처한다. 먼저 팀원 저장소에서
`service/server.js`를 실행하고, 실제 엔진 커밋 전체 SHA와 고정 ISO 시각을 명시한다.
같은 SHA·시각·엔진 응답은 byte 단위로 같은 fixture를 만든다.

```bash
npm run fixtures:capture -- \
  --base-url=http://127.0.0.1:8343 \
  --engine-commit=e7dcfb17632560d1e660b2380cc0ccfaab0ac894 \
  --generated-at=2026-07-21T15:26:11.445Z
npm run test:product-ui
```

다른 엔진 커밋을 캡처할 때는 두 provenance 값을 실제 값으로 함께 바꾼다.
