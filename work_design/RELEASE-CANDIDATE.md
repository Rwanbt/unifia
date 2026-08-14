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

## Human gates

`work_design/MANUAL-VERIFICATION.md` remains authoritative. MV-01 through MV-10 are still `PENDING`; in particular no desktop/native bridge, Android install/observation, SVG WebView, signing, merge, or publication claim is made by this candidate.

## Scope completed

M14–M22 now provide typed audit/approval/capability/export client flows, spec diagnostics, deterministic SVG and responsive previews, file and Design System models, artifact version/diff/provenance state, and shared mobile navigation. G6 remains open because no Design System catalog authority was invented.
