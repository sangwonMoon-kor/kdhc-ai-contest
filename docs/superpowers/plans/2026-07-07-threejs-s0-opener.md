# Three.js S0 Opener Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace S0 with a scroll-driven Three.js "work memory core" opener.

**Architecture:** Keep the static single-file demo shape. Vendor a global Three.js build locally, mount a full-bleed WebGL renderer inside S0, and let the existing `s0Update()` scroll progress drive the 3D scene and final hero reveal.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Three.js UMD build, Node static verification script.

## Global Constraints

- `demo/index.html` must still run from `file://` by double-click.
- Three.js must be local under `demo/vendor/`.
- S0 remains scroll-driven and `go(1)` still moves to S1.
- The primary 3D scene must be full-bleed and unframed.
- Do not introduce a build step.

---

### Task 1: Static Guard Test

**Files:**
- Create: `demo/tests/verify-three-opener.js`

**Interfaces:**
- Consumes: `demo/index.html`
- Produces: a command that exits 0 only when the S0 Three.js integration markers exist.

- [ ] Add a Node script that checks for `vendor/three.min.js`, `id="s0three"`, `initS0Three`, `updateS0Three`, `renderS0Three`, and a `THREE.WebGLRenderer` call.
- [ ] Run `node demo/tests/verify-three-opener.js`.
- [ ] Expected before implementation: FAIL because Three.js integration is not present.

### Task 2: Local Three.js Vendor

**Files:**
- Create: `demo/vendor/three.min.js`
- Modify: `demo/index.html`

**Interfaces:**
- Consumes: global `THREE`
- Produces: `window.THREE` for the existing script block.

- [ ] Download a fixed Three.js UMD build into `demo/vendor/three.min.js`.
- [ ] Add `<script src="vendor/three.min.js"></script>` before the existing inline script.
- [ ] Run `node demo/tests/verify-three-opener.js`.
- [ ] Expected after only this task: FAIL until S0 markup and functions are added.

### Task 3: Three.js S0 Scene

**Files:**
- Modify: `demo/index.html`

**Interfaces:**
- Consumes: `THREE`, `s0Update()` scroll progress.
- Produces: `initS0Three()`, `updateS0Three(p)`, `renderS0Three()`, `resizeS0Three()`.

- [ ] Replace S0 image scene layers with a `#s0three` canvas mount, caption rail, and existing hero block.
- [ ] Add CSS for the full-bleed canvas, subtle vignette, progress captions, and reduced-motion fallback text.
- [ ] Add JavaScript to build document cards, a glowing memory core, orbit rings, data particles, camera motion, and scroll-linked opacity/position changes.
- [ ] Run `node demo/tests/verify-three-opener.js`.
- [ ] Expected after implementation: PASS.

### Task 4: Visual Verification

**Files:**
- Modify: `demo/index.html` if layout fixes are needed.

**Interfaces:**
- Consumes: local browser rendering.
- Produces: confirmed S0 opener behavior.

- [ ] Open `demo/index.html`.
- [ ] Confirm S0 canvas is nonblank at 1920x1080.
- [ ] Scroll through S0 and confirm cards stream into the core, the camera pushes in, and the hero appears.
- [ ] Press right arrow / CTA and confirm S1 still opens.
