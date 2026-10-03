<!-- SPDX-License-Identifier: MIT -->
# RC-0 Design visual gate: three measured attempts, unresolved

Measured on Windows, 2026-10-03, starting from dev
`c15cc202e025506e0f32cbd558d8ae7b48962885`. No production change is delivered.
The experimental test patch is preserved in stash
`rc0-design-visual-three-attempts-20261003`; it is not a qualified fix.

## Contract and observed causes

`e2e/design/design-visual.spec.ts` freezes time, animations and fonts, then
requires identical PNG bytes before and after reload. Committed Windows
references have a zero-pixel tolerance. Neither gate was loosened, skipped
or regenerated during this investigation.

The direct `/design` navigation does not select the Editor layout. In
`session.tsx`, DesignSurface mounts only when workspaceView is not chat;
`context/layout.tsx` defaults to chat. The existing `openDesignSurface`
helper navigates through the mode button and selects Editor. ADR-085 makes
the canvas the Design workshop's initial tab.

The bridge-ready banner is not a canvas-ready signal. DesignCanvasTab waits
for repository.load before rendering its studio; DesignCanvas then lazily
creates its Konva renderer and exposes data-design-canvas-status=ready.
Waiting two animation frames after bridge readiness can capture an empty
studio during reload.

Selecting Editor focuses the topbar. Reload does not retain that focus.
`styles/v110.css` changes the topbar border under :focus-within. This accounts
for the measured full-width border difference, not a product layout change.

## Measurements

All attempts used the actual Chromium browser, one worker, zero retries:

```text
cd packages/app
bun run test:e2e:local e2e/design/design-visual.spec.ts -g 'renders identically'
```

| Attempt | Change under measurement | Result |
| --- | --- | --- |
| 1 | Reuse openDesignSurface | 0 pass / 2 fail; reload can show an empty canvas |
| 2 | Wait for visible canvas before fonts and two frames | 0 pass / 2 fail; light images differ by 1,294 pixels |
| 3 | Wait for canvas status ready; focus canvas and move pointer identically | 0 pass / 2 fail; light images differ by 18 pixels |

The second comparison's differences are 1,278 pixels at y=48 and 16 near
Checkpoint (x=866..870, y=748..751). After focus normalization, 16 Checkpoint
pixels remain plus two pixels at y=767 (x=94 and x=1257). Pixel counts were
computed from actual PNG RGB values, not inferred from their file sizes.
The dark comparison was also unsuccessful; its pixel distribution has not
been measured. No regression-versus-rasterization disposition is established
for the residual pixels.

Logs are retained under rc0-agent/.build-temp:
rc0-design-visual-fixture-20261003.log,
rc0-design-visual-fixture-loaded-20261003.log and
rc0-design-visual-fixture-focus-20261003.log. The final HTML report and its
PNG attachments are copied under
rc0-design-visual-three-attempts-20261003/playwright-report.
These are local artifacts, not uploaded release evidence.

## Stop and next options

Three unsuccessful attempts reached the mandate's stop threshold. No fourth
modification or trial is authorized by this diagnosis alone.

1. Inspect the residual PNG pixels alongside font loading and Checkpoint's
   computed geometry; establish whether text rasterization or layout changes.
2. Compare unmodified and experimental tests in an isolated normal clone,
   sequentially, with a pinned browser/font build; test whether the worktree
   environment affects these exact residual pixels.
3. If identical PNG bytes cannot represent the documented gate, propose a
   reviewed visual-contract decision with evidence. Do not silently change
   tolerance, mask controls or refresh golden images.

The eight committed visual references were not requalified by these two
reload witnesses. QA12R remains unqualified.
