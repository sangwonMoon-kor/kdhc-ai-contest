# Final review fixes report

Date: 2026-07-23
Branch: `feature/on-memory-workbench`
Initial implementation commit: `005b056` (`fix: close workbench final review findings`)
Important re-review commits:

- `ec37026` (`fix: normalize canonical document access overlays`)
- `0da9de0` (`fix: separate dismissed completion candidates`)

Final access-boundary implementation commit:

- `005617e` (`fix: make document access merging deny dominant`)

Status: `DONE_WITH_CONCERNS`

## Outcome

The initial ten final-review findings, the three Important re-review findings, and the final three access-boundary findings were addressed. The focused model/browser suites, adapter and capture contracts, regression suites, standalone data-mode contract, syntax checks, diff checks, and standalone sync contract all pass.

The earlier report revision stated that the generated local-maintenance fixture absence was the only remaining concern. A subsequent re-review identified three additional defects in live access normalization, fixture authorization overlays, and completion candidate status labeling. This revision supersedes that earlier claim; those defects are now fixed in the commits above.

The current status remains `DONE_WITH_CONCERNS` only because the standalone local-maintenance browser check cannot start without its ignored, locally generated `manifest.json`. Its builder and adapter overlay contracts pass with controlled data, while the environmental standalone result is recorded separately below.

No screenshots or goldens are included in the implementation commit. `verify-showcase-e2e.js` rewrote `product-ui/screenshots/showcase-golden.png` as a test side effect; the tracked file was restored after the passing run.

## Changes by finding

### 1. Canonical current access is the only document authorization source

- Added the central `resolveReferenceAccess(reference, canonicalReference)` model boundary.
- A source snapshot's stale or missing access value can no longer grant body access.
- `openEvidence` refreshes the canonical document index on every open and rechecks authorization immediately before the body request.
- Workbench reference cards, next-action evidence, caution evidence, and generic evidence all flow through the same authorization decision.
- Personal notes remain honest local artifacts and never masquerade as accessible document bodies.
- The canonical fixture index now explicitly declares `access: "full"` for its accessible documents.

TDD evidence:

- RED (model): `resolveReferenceAccess is not a function`.
- RED (browser): a stale source reference with `access: "full"` did not display the current canonical metadata/denial contract.
- GREEN: `Workbench model contract passed`.
- GREEN: `Workbench browser contract passed: vertical semantics, references, empty/access states, 390px layout`.
- The browser regression injects stale source access, canonical `access: "none"`, and a secret body. It checks reference, next-action, and caution entry points; all deny, expose no secret, and issue zero detail/body requests.

### 2. Newly created work has the complete v3 shape and remains active

- `createWorkFrom` now creates the complete v3 lifecycle and output structures.
- Work-list selection explicitly treats every non-completed work item as active.

TDD evidence:

- RED: a newly created item had `lifecycle === undefined`.
- GREEN: `Work list browser contract passed at 1920px and 390px`.

### 3. Explicit, accessible date editing replaces legacy due-date leakage

- Added an accessible date dialog with initial focus, focus trapping, Escape/cancel behavior, focus restoration, and explicit confirmation.
- No date mutates until the user confirms.
- Design and completion dates persist to their canonical lifecycle fields.
- List ordering/display and workbench headline context use canonical lifecycle dates only.
- Legacy `due` values no longer leak into these surfaces.
- Added D+3 coverage.

TDD evidence:

- RED (dialog): timed out waiting for `[data-work-date-dialog]`.
- RED (legacy due): the list did not show the canonical “일정 미정” state because a legacy due value leaked through.
- GREEN: `Work list browser contract passed at 1920px and 390px`.
- GREEN: `Workbench browser contract passed: vertical semantics, references, empty/access states, 390px layout`.

### 4. Default recurring fixture opens the correct stage; personal notes stay honest

- Changed the default recurring fixture stage to `design-and-costing` with the matching stage name.
- Preserved the explicit personal-note branch: it displays “개인 메모 · 연결된 문서 본문 없음” and offers no document action.
- Added browser diagnostics for page errors, console errors, and failed requests while exercising the untouched default fixture.

TDD evidence:

- RED (model): expected `design-and-costing`, received `maintenance-planning`.
- RED (browser): “local personal note renders a working-looking document action”.
- GREEN: `Workspace model contract passed`.
- GREEN: `Workbench browser contract passed: vertical semantics, references, empty/access states, 390px layout`.

### 5. Completion preserves historical presentation metadata, not historical authority

- Completion archives a whitelist of resolved reference presentation fields such as title, issuer, effective date, version, and rationale.
- Raw source identity is retained separately.
- Access/body fields are stripped from archived metadata.
- Completed re-entry presents the archived metadata but always resolves access against the current canonical index.
- The app passes resolved references into completion and refreshes current access on re-entry.

TDD evidence:

- RED (model): archived reference title was `undefined`.
- RED (browser): completed re-entry did not preserve the completion-time title after canonical metadata changed.
- GREEN: `Workbench model contract passed`.
- GREEN: `Completion browser contract passed: review, transition, read-only reentry, cloud bundle, dialog accessibility`.
- The regression changes canonical title/issuer/version and revokes access after completion; the completed view retains archived presentation, denies current body access, and makes zero body requests.

### 6. Duplicate note text cannot collide in milestone/todo identity

- Applied-item IDs now include stable note and candidate identity instead of depending on display text.
- Added a regression with identical note text at distinct times and verified that toggling one todo does not toggle the other.

TDD evidence:

- RED: expected two unique milestone IDs, received one.
- GREEN: `Workbench model contract passed`.

### 7. Completion labels distinguish raw records from confirmed candidates

- Renamed the raw section to “진행 기록”.
- Separated original records, user-confirmed candidates, and unconfirmed candidates.
- Completed candidates show their label and basis read-only, without editing controls.

TDD evidence:

- RED: “completion review did not label raw progress records honestly”.
- GREEN: `Completion browser contract passed: review, transition, read-only reentry, cloud bundle, dialog accessibility`.

### 8. Fixture/live/auto data-mode behavior has a browser contract

- Extended the browser contract to open the same semantic route in fixture, live, and auto modes against the controlled API stub.
- Each mode must render the expected sections and route semantics.

This finding was a coverage gap, not a reproducible product defect. The new characterization assertions were baseline-green, so no false RED result is claimed.

- GREEN: `App data-mode contract passed`.
- GREEN: `App data-mode browser contract passed`.

### 9. Completion timestamps reject normalized but impossible ISO values

- Replaced permissive date normalization with strict ISO-shape and round-trip validation.
- Impossible calendar dates/times can no longer be silently normalized into valid-looking completion timestamps.

TDD evidence:

- RED: `Missing expected exception: normalized nonexistent completion timestamp`.
- GREEN: `Workbench model contract passed`.

### 10. Cloud routes preserve exact historical bundle identity

- Cloud hashes now carry both work and bundle identity: `#workbench/<workId>/<bundleId>`.
- The route selects the exact requested bundle when an identity is present.
- Routes without a bundle identity retain the documented latest-bundle behavior.
- The rendered workbench exposes its selected bundle identity for contract testing.

TDD evidence:

- RED: the browser timed out waiting for the bundle-specific historical hash.
- GREEN: `Completion browser contract passed: review, transition, read-only reentry, cloud bundle, dialog accessibility`.

## Important re-review wave

### R1. Live and auto document indexes normalize legacy access at the adapter boundary

- Live `/api/documents` entries are cloned with explicit `access: "full"` when the authenticated canonical index contains them and the backend omitted access.
- An exact explicit `access: "full"` remains full and an exact explicit `access: "none"` remains denied.
- No other explicit value is trusted. `null`, empty strings, `restricted`, and unknown/future enums normalize to `none`.
- Fixture/captured indexes do not receive the legacy grant and must already contain `full|none`.
- Unknown IDs remain absent from the canonical index and fail closed.
- `resolveReferenceAccess` was not loosened; it still authorizes only an exact canonical `access: "full"`.
- Added an actual `JikmuApi` browser contract for fixture, live, and auto modes. In every mode, an indexed allowed document opens, an explicit denial and an unknown special-like `PROC-MAINT-*` ID expose no body and issue no detail request.

TDD evidence:

- RED (adapter): `authenticated live index presence did not normalize the legacy access grant`.
- RED (actual browser): `live actual client did not grant a canonical indexed document`.
- GREEN: `API client contract passed`.
- GREEN: `Actual API-client access browser contract passed in fixture, live, and auto modes`.

### R2. Fixture document overlays are explicit and availability-aware

- The captured fixture manifest carries an explicit `DOC-FIXTURE-001` canonical overlay.
- The fixture adapter merges manifest document overlays into the strict base index.
- The capture boundary normalizes legacy authenticated index entries to explicit access, preserves explicit denial, validates `full|none`, and emits the ingested-document overlay.
- The local-maintenance builder emits an explicit `PROC-MAINT-31100` index overlay in its ignored local manifest.
- After the local maintenance ask fixture is successfully selected, the adapter reads the private access-bearing manifest. A full grant must also verify the routed detail before it is advertised; a denial returns metadata without touching detail. A missing manifest or missing full-grant detail yields no entry.
- Unknown special-like IDs are never synthesized.
- The fixture ingest flow now opens `DOC-FIXTURE-001` through the real evidence drawer and verifies its body.
- No files were created or changed in the external sibling `jikmu-memory` repository.

TDD evidence:

- RED (capture validation): `Missing expected exception: capture validation accepted an implicit document access value`.
- RED (builder): `generated local fixture omitted its explicit canonical document index overlay`.
- RED (fixture manifest): `manifest missing explicit DOC-FIXTURE-001 canonical access overlay`.
- RED (fixture flow): `ingested fixture document was not added to the canonical access index`.
- GREEN: `Capture response, CLI, and reproducibility validation passed`.
- GREEN: `Local maintenance fixture builder contract passed`.
- GREEN: `Fixture contract passed`.
- GREEN: `Fixture reachable-flow E2E passed (graph, non-design draft, hint, scanned-PDF extract, ingest)`.
- The unavailable-local-overlay unit case confirms that a missing private manifest produces no advertised canonical entry.

### R3. Completion review renders dismissed candidates truthfully

- Proposed candidates remain under “확인 전 후보”.
- Dismissed candidates render separately under “건너뛴 후보” with their actual “건너뜀” status.
- Confirmed candidates remain under the user-confirmed section.

TDD evidence:

- RED: `completion review placed a dismissed candidate under 확인 전 후보`.
- GREEN: `Completion browser contract passed: review, transition, read-only reentry, cloud bundle, dialog accessibility`.

## Final access-boundary wave

### F1. Compatibility trust applies only to an omitted access property

- The live/auto adapter checks property presence, not truthiness or enum inequality.
- A genuinely absent property receives the authenticated legacy compatibility grant.
- Exact `full` remains full; exact `none` remains none.
- Every other explicit value, including `null`, `""`, `restricted`, and a future enum, normalizes to `none`.
- The capture boundary applies the same rule before emitting mandatory `full|none`.
- Strict fixture and capture validation reject missing or invalid explicit access in persisted artifacts.

TDD evidence:

- RED (adapter): `legacy grant trusted an explicit unknown access value`.
- RED (capture): `capture boundary trusted an explicit unknown access value`; the observed actual result incorrectly mapped both `null` and `restricted` to `full`.
- GREEN: `API client contract passed`.
- GREEN: `Capture response, CLI, and reproducibility validation passed`.

### F2. Duplicate and overlay merges are unique and deny-dominant

- Runtime normalization collapses repeated IDs to one canonical entry.
- Capture normalization emits one entry per ID.
- A denial in either duplicate or overlay layer dominates a full grant, independent of order.
- An overlay may add a missing ID, but cannot elevate an existing `none`.
- Same-access duplicates also collapse, so array lookup and map lookup cannot disagree about which entry is canonical.

TDD evidence:

- RED (runtime duplicates): `live normalization returned duplicate IDs or allowed a conflicting duplicate`.
- RED (capture duplicates): `capture boundary emitted duplicate IDs or allowed a conflicting duplicate`.
- RED (isolated cross-layer merge): after temporarily removing deny-dominant cross-layer merging, the focused contract failed with `base none cannot be elevated by overlay full`; restoring the implementation returned the suite to green.
- GREEN: `API client contract passed`.
- GREEN: `Capture response, CLI, and reproducibility validation passed`.
- Fixture validation also asserts that the persisted captured index contains no duplicate IDs.

### F3. Denied private local metadata never triggers a detail request

- The local overlay resolver validates the access-bearing manifest entry before any private document request.
- Exact `none` returns canonical denial metadata without fetching detail/body.
- A missing manifest or missing full-grant detail is not advertised.
- Exact `full` may verify the routed detail before advertising readable access.

TDD evidence:

- RED: `denied local overlay fetched private document detail`.
- GREEN: `API client contract passed`.
- The controlled request-count assertion records zero requests to `local-maintenance/documents/PROC-MAINT-31100.json` for an `access: "none"` overlay.

## Adjacent regression coverage

- Workspace migration preserves all draft fields and deep-copies nested completion bundles.
- Active work-list layout has no horizontal overflow at 390px.
- Tone helpers expose `role="status"`, preserve every placeholder value, and never apply unconfirmed text.
- Candidate label/basis controls and their read-only completed rendering are covered.
- Restricted access is exercised through reference cards, next actions, caution evidence, and generic evidence.
- Untouched default fixture loading asserts no page error, console error, or failed request.
- Showcase expectations now use the canonical empty schedule state rather than the retired legacy due value.

## Final verification

### Static checks

Passed:

```text
git diff --check
node --check product-ui/workspace-model.js
node --check product-ui/workbench-model.js
node --check product-ui/app.js
node --check product-ui/tests/verify-app-data-mode-browser.js
node --check product-ui/tests/verify-completion-browser.js
node --check product-ui/tests/verify-showcase-e2e.js
node --check product-ui/tests/verify-work-list-browser.js
node --check product-ui/tests/verify-workbench-browser.js
node --check product-ui/tests/verify-workbench-model.js
node --check product-ui/tests/verify-workspace-model.js
node --check product-ui/api-client.js
node --check product-ui/tests/verify-api-client.js
node --check product-ui/tests/verify-api-access-browser.js
node --check product-ui/tests/verify-fixture-reachable-flows.js
node --check tools/build-local-maintenance-fixture.js
node --check tools/capture-product-fixtures.js
node --check tools/tests/verify-build-local-maintenance-fixture.js
node --check tools/tests/verify-capture-product-fixtures.js
```

### Focused model/browser contracts

All passed:

```text
Workspace model contract passed
Workbench model contract passed
Work list browser contract passed at 1920px and 390px
Workbench browser contract passed: vertical semantics, references, empty/access states, 390px layout
Completion browser contract passed: review, transition, read-only reentry, cloud bundle, dialog accessibility
Product shell browser contract passed
```

### Regression contracts

All passed:

```text
Product UI source contract passed
Home state contract passed
Home browser contract passed
Schedule browser contract passed
Home model contract passed
API client contract passed
Fixture contract passed
Local maintenance fixture builder contract passed
Capture response, CLI, and reproducibility validation passed
Fixture reachable-flow E2E passed (graph, non-design draft, hint, scanned-PDF extract, ingest)
Showcase E2E passed (active data: 시연용 샘플 데이터; fixture API requests: 0)
```

The first manual regression invocation used stale filenames for the API/reachable scripts and produced `MODULE_NOT_FOUND`; it was immediately rerun with the repository's actual `verify-api-client.js` and `verify-fixture-reachable-flows.js` names, shown passing above. This was an invocation error, not a product-test failure.

During the final access-boundary wave, the first combined fixture-flow launch encountered `EADDRINUSE` on computed port `9229`, which was owned by an unrelated `workerd` listener. A fresh standalone invocation selected another port and passed with the output shown above.

### Standalone data-mode contract

Command:

```text
npm run test:product-ui:data-mode
```

Result: exit 0.

```text
App data-mode contract passed
App data-mode browser contract passed
Actual API-client access browser contract passed in fixture, live, and auto modes
```

### Standalone sync contract

Command:

```text
/usr/bin/time -p npm run test:product-ui:sync
```

Result: exit 0, within the required 120-second ceiling.

```text
UI sync hardened contract passed
real 77.82
user 44.45
sys 19.56
```

### Known local-maintenance fixture absence

Command:

```text
npm run test:product-ui:local-maintenance
```

Result: exit 1 before exercising application behavior.

```text
AssertionError [ERR_ASSERTION]: local maintenance fixture missing: manifest.json; run tools/build-local-maintenance-fixture.js first
```

This is the known generated-fixture absence called out in the task. The private fixture was not generated or committed. Its builder contract and controlled adapter overlay tests pass independently.

## Files changed

- `product-ui/app.js`
- `product-ui/fixtures/documents/index.json`
- `product-ui/style.css`
- `product-ui/tests/verify-app-data-mode-browser.js`
- `product-ui/tests/verify-completion-browser.js`
- `product-ui/tests/verify-showcase-e2e.js`
- `product-ui/tests/verify-work-list-browser.js`
- `product-ui/tests/verify-workbench-browser.js`
- `product-ui/tests/verify-workbench-model.js`
- `product-ui/tests/verify-workspace-model.js`
- `product-ui/workbench-model.js`
- `product-ui/workspace-model.js`

Important re-review additions/updates:

- `package.json`
- `product-ui/api-client.js`
- `product-ui/app.js`
- `product-ui/fixtures/manifest.json`
- `product-ui/tests/verify-api-access-browser.js`
- `product-ui/tests/verify-api-client.js`
- `product-ui/tests/verify-completion-browser.js`
- `product-ui/tests/verify-fixture-reachable-flows.js`
- `product-ui/tests/verify-fixtures.js`
- `product-ui/tests/verify-workbench-model.js`
- `tools/build-local-maintenance-fixture.js`
- `tools/capture-product-fixtures.js`
- `tools/tests/verify-build-local-maintenance-fixture.js`
- `tools/tests/verify-capture-product-fixtures.js`

## Remaining concern

The earlier “only fixture absence remains” statement was premature because it preceded the subsequent review waves. At the current HEAD, the Important re-review defects and final access-boundary defects are fixed, and no review finding is knowingly deferred. The only remaining concern is environmental: the ignored local-maintenance `manifest.json` has not been generated, so its standalone browser check exits before application behavior.
