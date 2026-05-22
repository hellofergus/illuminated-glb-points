# Illuminated — Cleanup Plan

## Issues Index

| ID | Category | Severity | Status |
|----|----------|----------|--------|
| C1 | Null-unsafe geometry attribute access | 🔴 CRITICAL | TODO |
| C2 | O(N) full projection scan on every mousemove | 🔴 CRITICAL | TODO |
| C3 | O(N) brush loop scans all points per stroke | 🔴 CRITICAL | TODO |
| C4 | Poisson/grid size has no upper bound | 🔴 CRITICAL | TODO |
| M1 | No Three.js cleanup on unmount | 🟡 MEDIUM | TODO |
| M2 | Session fingerprint stringifies full point array | 🟡 MEDIUM | TODO |
| M3 | O(N×M) in appendDetailBoostPoints | 🟡 MEDIUM | TODO |
| M4 | Cloned point size unchecked (can be 0) | 🟡 MEDIUM | TODO |
| M5 | Multiple setState calls per tool switch | 🟡 MEDIUM | TODO |
| M6 | App.tsx god component (~3700 lines) | 🟡 MEDIUM | TODO |
| M7 | Split geometry ownership App.tsx / pointCloud.ts | 🟡 MEDIUM | TODO |
| L1 | Duplicated bilinear sampling logic | 🟢 LOW | TODO |
| L2 | Duplicated luminosity formula | 🟢 LOW | TODO |
| L3 | Ref-sync pattern repeated 10+ times | 🟢 LOW | TODO |
| L4 | `any` type in useSelectionActions.ts | 🟢 LOW | TODO |
| L5 | Magic numbers without named constants | 🟢 LOW | TODO |
| L6 | Palette input silently drops invalid hex | 🟢 LOW | TODO |
| L7 | Selection restore silently filters indices | 🟢 LOW | TODO |
| L8 | Single-pixel image UV edge case | 🟢 LOW | TODO |

---

## 🔴 C1 — Null-unsafe geometry attribute access

### Problem
`geometry.getAttribute(name)` returns `BufferAttribute | null` per THREE.js types.
Every call site casts directly to `THREE.BufferAttribute` without a null check, then
immediately dereferences `.count` or `.getX()`. If geometry is in a transitional state
(mid-rebuild, attribute missing), this throws and crashes the whole app silently.

### Affected locations in `src/App.tsx`
1. `getSyncedPointsFromScene` — `position` + `visibility` cast, dereferenced in `.map()`
2. `getVisibleProjectedPointIndices` — `position` + `visibility` cast, used in `for` loop
3. `getClonedPointAppearance` — `color` + `size` cast; the existing safety check
   `colorAttr.count` already throws before it can protect anything when `colorAttr` is null
4. Brush application block — `visibility` + `size` cast, used in hot `for` loop

### Fix Strategy
Change every cast from `as THREE.BufferAttribute` to `as THREE.BufferAttribute | null`,
then add an early-return / passthrough guard before the first dereference at each site.

### Acceptance Criteria
- [ ] Every `geometry.getAttribute(name)` call is typed as `T | null`
- [ ] Every affected call site returns a safe fallback before any dereference
- [ ] `npx tsc --noEmit` passes with zero new errors
- [ ] Behaviour when attributes ARE present is byte-for-byte identical (no regression)
- [ ] No bare `as THREE.BufferAttribute` cast remains without a preceding null guard

### Review Loop
1. Check all four locations — confirm null guard precedes first dereference
2. Verify fallback values are sensible (empty array / passthrough copy / null / early return)
3. Run `npx tsc --noEmit` — must pass clean
4. Manual smoke test: load cloud → paint → clone point → undo → no crash
5. If any criterion is unmet → revise and repeat from step 1

---

## 🔴 C2 — O(N) full projection scan on every mousemove

### Problem
`getVisibleProjectedPointIndices()` projects every visible point through the camera
matrix on every mousemove, regardless of where the mouse is. At 50k points this is
50k matrix multiplications per frame. It is called from the brush handler, the
selection handler, and the point-pick handler — all firing during mouse interaction.

### Affected locations in `src/App.tsx`
- `getVisibleProjectedPointIndices` (defined ~line 1599, called at lines 1770, 2175, 2431, 2740, 2758, 2780)

### Fix Strategy
Add a screen-space bounding box pre-filter: only project points whose world-space
bounding contribution could reach the visible viewport region near the current pointer.
A coarse frustum cull using the camera's projection matrix prevents projecting points
that are trivially off-screen.

### Acceptance Criteria
- [ ] Selection and point-picking interactions work identically to before
- [ ] Frame time budget during mousemove does not scale linearly with total point count
- [ ] No regression in select-by-rectangle, nearest-point picking, or brush-select
- [ ] All six call sites receive correct hit data

### Review Loop
1. Profile mousemove at 50k points before and after — confirm iteration count is
   sublinear relative to total points
2. Test all selection modes (click pick, drag-rect, brush-select) still produce correct results
3. Test at a camera angle where many points are off-screen — confirm they are skipped
4. If any criterion unmet → revise and repeat from step 1

---

## 🔴 C3 — O(N) brush loop per stroke

### Problem
The brush paint handler iterates all N points to compute world-space distance to the
brush center on every mousemove, even points that are spatially far from the brush.
At 100k points with a typical brush covering ~0.1% of the cloud, 99,900 distance
calculations are wasted per event. This is the dominant cost during painting.

### Affected locations in `src/App.tsx`
- Brush application `for` loop starting ~line 2480 (`for (let i = 0; i < visibilityAttr.count; i++)`)

### Fix Strategy
Maintain a lightweight spatial grid (column/row buckets keyed by XY world position)
that is rebuilt whenever the point cloud changes. The brush loop then only visits the
buckets that overlap the brush's world-space AABB, reducing iteration to O(points in
brush area) instead of O(all points).

### Acceptance Criteria
- [ ] All brush modes (hide, reveal, thin, push, pull, soften, grow, shrink, paint, stamp) work identically
- [ ] Only points within brush radius + 1 cell margin are tested per stroke
- [ ] No visible stall during painting at 50k+ points
- [ ] Brush softness falloff and strength behaviour are unchanged
- [ ] Spatial grid is invalidated and rebuilt correctly after point cloud rebuild

### Review Loop
1. Profile the paint loop at 50k points — confirm iteration count proportional to brush
   area, not total count
2. Test each brush mode at minimum and maximum brush sizes
3. Paint near cloud edges — confirm no points are missed at boundaries
4. If any criterion unmet → revise and repeat from step 1

---

## 🔴 C4 — Poisson/grid size has no upper bound

### Problem
In both `handleReduceDensity` and the thin brush post-pass, grid dimensions are:

```
gridCols = Math.ceil(bboxExtent / gridCell) + 2
```

If `gridCell` approaches zero (degenerate cloud where all points share near-identical
XY positions, or `targetCount` is very large relative to bbox area), `gridCols` can
reach millions. Map keys then reach into the billions, causing the tab to hang or
exhaust memory with no user-visible error.

### Affected locations in `src/App.tsx`
- `handleReduceDensity` (~line 3675): `gridCols` / `gridRows`
- Thin brush post-pass (~line 2670): `gridCols2` / `gridRows2`

### Fix Strategy
Clamp both `gridCols` and `gridRows` to a safe maximum (4096 × 4096 = 16M cells max)
at both locations. Also enforce a matching minimum on `gridCell` so the formula cannot
produce a cell smaller than `bboxExtent / 4094`.

### Acceptance Criteria
- [ ] `gridCols` and `gridRows` are clamped to ≤ 4096 at both locations
- [ ] A complementary `gridCell` minimum prevents bypassing the clamp
- [ ] Running reduction on a degenerate cloud (all same XY) completes without hang
- [ ] Running reduction on a normal cloud still produces the correct target count
- [ ] Thin brush still thins correctly after the guard is in place

### Review Loop
1. Confirm both Poisson sites have explicit upper-bound guards on grid dimensions
2. Test `handleReduceDensity` on a degenerate cloud — must complete in < 1s
3. Test `handleReduceDensity` on a normal 50k cloud targeting 30k — result count must
   be exactly 30k (within fallback tolerance)
4. Test thin brush on a dense cluster — must thin without hang
5. If any criterion unmet → revise and repeat from step 1

---

## 🟡 M1 — No Three.js cleanup on unmount

### Problem
The Three.js setup `useEffect` in `App.tsx` creates a `WebGLRenderer`, `BufferGeometry`,
`Material`, `OrbitControls`, and attaches event listeners (`controls.addEventListener`,
`window.addEventListener` for mouse/keyboard). None of these are disposed or removed
in a cleanup function. Memory accumulates over long sessions; dangling listeners persist
if the component ever remounts.

### Affected locations
- `src/App.tsx` Three.js init `useEffect` (~line 1490)

### Acceptance Criteria
- [ ] useEffect returns a cleanup function
- [ ] Renderer, geometries, materials, and controls are disposed on cleanup
- [ ] All window/canvas event listeners are removed on cleanup
- [ ] No memory leak detectable in DevTools heap snapshot after unmount/remount

### Review Loop
1. Mount → interact → unmount → take heap snapshot → confirm no retained THREE objects
2. Remount → confirm app works identically to first mount
3. If any criterion unmet → revise and repeat

---

## 🟡 M2 — Session fingerprint stringifies full point array

### Problem
`getSessionFingerprint()` calls `JSON.stringify` on the full session object including
all points (up to 100k+ entries) on every dirty-check cycle. This freezes the main
thread periodically, especially visible during autosave or rapid parameter changes.

### Affected locations
- `src/App.tsx` `getSessionFingerprint` and its call sites

### Acceptance Criteria
- [ ] Fingerprint does not serialize individual point data
- [ ] Dirty detection still correctly identifies changed sessions
- [ ] No perceptible pause during parameter changes or painting

### Review Loop
1. Open session with 100k points, change a param — no freeze observable
2. Save session — confirm dirty flag clears correctly
3. If any criterion unmet → revise and repeat

---

## 🟡 M3 — O(N×M) in appendDetailBoostPoints

### Problem
`hasNearbyExistingPoint()` in `pointSampler.ts` does a linear scan over all existing
points per candidate pixel during the detail-boost pass. On a 1000×1000 image with
10k growing points this is ~10 billion distance checks, causing second-long stalls
during point generation.

### Affected locations
- `src/processing/pointSampler.ts` `hasNearbyExistingPoint` and its call site

### Acceptance Criteria
- [ ] Spatial lookup for nearby points is O(1) per query (grid or hash-based)
- [ ] Generated point distribution is visually equivalent to current output
- [ ] Generation time for a 1000×1000 image does not exceed 5s on a modern machine

### Review Loop
1. Profile point generation on a 1000×1000 image — confirm no O(N×M) inner loop
2. Compare output visually against pre-fix for same seed/params
3. If any criterion unmet → revise and repeat

---

## 🟡 M4 — Cloned point size can be zero

### Problem
`getClonedPointAppearance()` reads `sizeAttr.getX(cloneIndex)` with no lower-bound
guard. If a degenerate point with size=0 is selected as clone source, all stamped
points are invisible with no error feedback.

### Affected locations
- `src/App.tsx` `getClonedPointAppearance` return value

### Acceptance Criteria
- [ ] Returned `size` is clamped to `Math.max(0.1, sizeAttr.getX(cloneIndex))`
- [ ] Stamped points are always visible when a valid clone source is selected

### Review Loop
1. Set a point's size to 0, select it as clone source, stamp — points must be visible
2. Normal clone workflow unchanged

---

## 🟡 M5 — Multiple setState calls per tool switch

### Problem
The tool-mode `useEffect` fires 2–6 `setState` calls per tool change (e.g.
`setSelectionModeEnabled` + `setBrushSettings`), each scheduling a separate render.
This causes cascading re-renders and visible flicker when switching tools rapidly.

### Affected locations
- `src/App.tsx` tool-bridge `useEffect` (~line 422)

### Acceptance Criteria
- [ ] Tool switches trigger at most one render cycle
- [ ] All tool modes still activate correctly
- [ ] No flicker observable during tool switching

### Review Loop
1. Add React DevTools Profiler — single tool click must show ≤ 1 commit
2. Cycle through all tools — confirm each activates correctly
3. If any criterion unmet → revise and repeat

---

## 🟡 M6 — App.tsx god component (~3700 lines)

### Problem
`App.tsx` owns Three.js scene init, brush physics, session persistence, undo/redo,
file I/O, color transforms, and tool state — all in a single component. Nothing is
independently testable, and any change risks unintended side effects across systems.

### Proposed split
```
src/
  hooks/
    useBrush.ts          — brush state + application loop
    useSession.ts        — save / load / fingerprint
    usePointCloud.ts     — scene + geometry ownership
  App.tsx                — orchestration only, < 300 lines
```

### Acceptance Criteria
- [ ] Each hook is independently importable and testable
- [ ] App.tsx is under 300 lines after extraction
- [ ] All existing functionality is preserved end-to-end
- [ ] No cross-hook direct state mutation (only via returned callbacks)

### Review Loop
1. After each hook extraction, run full manual smoke test
2. TypeScript must compile clean after each phase
3. If any criterion unmet → revise and repeat

---

## 🟡 M7 — Split geometry ownership between App.tsx and pointCloud.ts

### Problem
`App.tsx` directly mutates geometry buffer attributes (`positionAttr.setZ`,
`visibilityAttr.setX`, `sizeAttr.setX`, `.needsUpdate = true`) while `pointCloud.ts`
also creates and manages the same geometry. No clear ownership — changes in either
file can silently break the other.

### Acceptance Criteria
- [ ] All geometry mutation goes through a single owner (either the manager in
  `pointCloud.ts` or a dedicated `PointCloudEngine` class)
- [ ] App.tsx contains no direct `BufferAttribute` mutations
- [ ] All brush modes still work correctly via the new abstraction

### Review Loop
1. Search App.tsx for direct `.setX` / `.setZ` / `.needsUpdate` calls — must be zero
2. Run all brush modes — confirm no regression
3. If any criterion unmet → revise and repeat

---

## 🟢 Low Priority Issues (L1–L8)

These are maintenance and readability issues with no runtime impact. Tackle after all
Critical and Medium items are resolved.

| ID | Issue | One-line fix |
|----|-------|-------------|
| L1 | Duplicated bilinear sampling | Extract to `src/utils/sampler.ts` |
| L2 | Duplicated luminosity formula | Extract to `src/utils/color.ts` |
| L3 | Ref-sync pattern ×10 | Extract `useSyncRef<T>()` hook |
| L4 | `any` in useSelectionActions | Type `setBrushSettings` properly |
| L5 | Magic numbers | Named constants at top of file |
| L6 | Palette input silent drop | Show parse error in status bar |
| L7 | Selection restore silent filter | Log count of filtered indices |
| L8 | Single-pixel UV edge case | Guard `width > 1` before dividing |

---

## Global Acceptance Criteria (all items)

Before marking any item DONE:
1. `npx tsc --noEmit` — zero errors
2. Build succeeds: `npx vite build --mode development`
3. Manual smoke test passes:
   - Load source + depth image → generate points
   - Paint with each brush mode (hide, reveal, thin, push, pull, soften, grow, shrink)
   - Undo / redo chain works
   - Export GLB succeeds
   - Save / load session round-trips correctly
4. No new console errors or warnings introduced

---

_Last updated: 2026-05-22_
