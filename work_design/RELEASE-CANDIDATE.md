# Unifia Work/Design release candidate

**Branch**: `work-design`  
**Base**: `dev` at `91daa35a26a8e44d7f35b539c91030ec1e230c54`  
**Candidate commit**: the commit containing this file on `work-design`  
**Status**: implementation complete; human release gates pending

## Automated evidence

- Workbench Shell typecheck: PASS.
- Workbench Shell full suite: 11 files, 0 failures; WorkbenchShell 122/122, client 20/20, DesignSpecPanel 5/5, DesignRenderer 5/5, DesignPreviewPanel 4/4, DesignFiles 6/6, DesignSystem 3/3, ArtifactVersionPanel 4/4, MobileNavigation 4/4, modes 4/4, routes 11/11.
- Remote turbo typecheck on the latest push: 35/35 successful.
- CI conformance repair remains green at 8/8; the non-blocking Node 20/24 action warning remains known.
- Fresh local conformance rerun: PASS 8/8, 43 suites (41 Bun + 2 Vitest), 25 owned packages lint clean; browser E2E is explicitly skipped because it requires a real browser.
- GitHub Actions confirmation: run `31761195329` completed `success` for `unifia-conformance` on code commit `aede7fc1c5fba75e7b857a657ce8b70f90a5ffd5`; later documentation-only pushes do not match the workflow path filter.
- Static CSP extraction: PASS for explicit Tauri origins, loopback/IPC scoping, `img-src data:`, `object-src 'none'`, and `frame-ancestors 'none'`; the runtime server remains self/data-only for `connect-src`. MV-09 still requires packaged-bundle extraction and interactive allow/deny checks.
- Workbench UI wiring: PASS for the existing route composition; Work renders and selects from the shared eleven-function registry, while Design offers editable validation diagnostics and three responsive SVG previews through image sources. App typecheck and 704 unit tests pass.
- App production bundle: PASS; Vite build completed successfully, with existing chunk-size, CSS minifier, and dynamic-import warnings recorded but no build error.

## Human gates

`work_design/MANUAL-VERIFICATION.md` remains authoritative. MV-01 through MV-10 are still `PENDING`; in particular no complete desktop/native bridge, Android lifecycle, SVG WebView, merge, or publication claim is made by this candidate.

Partial device evidence now exists for MV-03: a debug-signed local copy installed and launched on `b7163823`, with healthy loopback runtime. The full Android Work/Design, lifecycle and SVG inert procedures remain pending.

## Scope completed

M14–M22 now provide typed audit/approval/capability/export client flows, spec diagnostics, deterministic SVG and responsive previews, file and Design System models, artifact version/diff/provenance state, and shared mobile navigation. G6 remains open because no Design System catalog authority was invented.
