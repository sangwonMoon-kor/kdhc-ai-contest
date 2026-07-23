# Final review fixes report

Date: 2026-07-23  
Branch: `feature/on-memory-workbench`  
Implementation commit: `005b056` (`fix: close workbench final review findings`)  
Status: `DONE_WITH_CONCERNS`

## Outcome

All ten final-review findings were addressed, and the requested adjacent regression coverage was added. The focused model/browser suites, regression suites, standalone data-mode contract, syntax checks, diff checks, and standalone sync contract all pass.

The status is `DONE_WITH_CONCERNS` only because the pre-existing standalone local-maintenance check cannot start without its generated `manifest.json`. That result is recorded separately below and was not hidden by an aggregate command.

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
Fixture reachable-flow E2E passed (graph, non-design draft, hint, scanned-PDF extract, ingest)
Showcase E2E passed (active data: 시연용 샘플 데이터; fixture API requests: 0)
```

The first manual regression invocation used stale filenames for the API/reachable scripts and produced `MODULE_NOT_FOUND`; it was immediately rerun with the repository's actual `verify-api-client.js` and `verify-fixture-reachable-flows.js` names, shown passing above. This was an invocation error, not a product-test failure.

### Standalone data-mode contract

Command:

```text
npm run test:product-ui:data-mode
```

Result: exit 0.

```text
App data-mode contract passed
App data-mode browser contract passed
```

### Standalone sync contract

Command:

```text
/usr/bin/time -p npm run test:product-ui:sync
```

Result: exit 0, within the required 120-second ceiling.

```text
UI sync hardened contract passed
real 61.39
user 39.76
sys 16.05
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

This is the known generated-fixture absence called out in the task. The fixture builder was not run because it is outside the final-review change scope and would introduce generated artifacts.

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

## Remaining concern

Only the absent generated local-maintenance `manifest.json` remains. No final-review finding is knowingly deferred.
