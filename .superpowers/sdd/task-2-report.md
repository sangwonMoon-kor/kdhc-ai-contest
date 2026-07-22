# Task 2 report — existing work state calendar/candidate fields

## Scope completed

- Kept localStorage schema at `v: 1` and preserved legacy works that have no calendar fields.
- Added normalization for optional work fields: `calendarStart`, `calendarCategory`, and `scheduleCandidates`; record fields `dateISO` and `calendarStatus` are retained when valid strings.
- Kept forecast seeds' source `dueDate` and document IDs unchanged; no calendar start date is inferred.
- Linked dated record text to `home-model.js`'s `parseScheduleCandidate` only after a work has been selected.
- Added `confirmScheduleCandidate(workId, candidateId)`. It marks the candidate confirmed, creates a dated `schedule` record with `calendarStatus: "confirmed"`, and stores a single undo action that restores the candidate and removes that record.
- Added `test:product-ui:home-state` without changing the existing aggregate script or its known Windows POSIX environment-assignment limitation.

## TDD evidence

RED was captured before implementation with:

```text
ReferenceError: normalizeWork is not defined
App data-mode contract failed:
- app does not use the home model for schedule candidates
- schedule candidate confirmation action missing
- schedule confirmation record status missing
```

## Verification

```text
node product-ui/tests/verify-home-state.js  -> Home state contract passed
node product-ui/tests/verify-app-data-mode.js -> App data-mode contract passed
node product-ui/tests/verify-home-model.js -> Home model contract passed
```

## Self-review

- The change is state-only; no current home rendering markup or styles were changed.
- Candidate IDs are retained in addition to the required candidate fields so `confirmScheduleCandidate(workId, candidateId)` can target and undo a specific candidate.
- No aggregate test command was changed or run because its existing POSIX environment-assignment segment is known to be incompatible with Windows and is outside Task 2.
