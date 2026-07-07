# Three.js S0 Opener Design

## Goal

Replace the current S0 image crossfade opener with a full-screen Three.js scene that shows scattered work documents becoming a persistent "job memory" core.

## Approved Direction

Use the "work memory core" concept:

1. Many floating document cards enter the scene as messy inherited work.
2. The cards orbit, classify, and stream into a warm orange core.
3. The camera pushes through the core into the existing hero message: "사람은 떠나도, 업무는 남게."

## Constraints

- Keep the demo runnable by double-clicking `demo/index.html`.
- Vendor Three.js locally under `demo/vendor/`; do not depend on a CDN at presentation time.
- Keep all navigation semantics: S0 remains scroll-driven, `go(1)` still starts S1, arrow keys still work.
- Use a full-bleed canvas, not a card or framed preview.
- Avoid complex external 3D assets; use generated Three.js geometry for speed and reliability.

## Implementation Shape

- Add `demo/vendor/three.min.js` as a local global Three.js build.
- Replace the old S0 `.sc` image layers with a `#s0three` canvas mount and lightweight caption overlays.
- Add `initS0Three()`, `updateS0Three(p)`, `renderS0Three()`, and `resizeS0Three()` in `demo/index.html`.
- Keep the existing `s0Update()` scroll progress function, but drive Three.js scene state from `p`.
- Preserve the final `.s0-hero` reveal through the existing `done` class.

## Verification

- Static test: `node demo/tests/verify-three-opener.js`.
- Browser check: open `demo/index.html`, confirm S0 shows a nonblank full-screen 3D scene, scroll motion changes camera/cards/core, and S1 navigation still works.
