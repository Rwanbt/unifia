<!-- SPDX-License-Identifier: MIT -->
# RC-0 canvas specs seed and assert against a store the product no longer owns

Measured on `dev@41434f690c` in the clean clone, Windows Chromium, workers 1,
retries 0. Logs: `e2e-next1.log`, `e2e-canvas-alone.log`, `e2e-probe14.log`.
The probe was a throwaway spec, created, run and deleted; it is not in the diff.

This covers `canvas-layers.spec.ts:86` and `canvas-import.spec.ts:39`, and the
same reasoning applies to the rest of the `canvas-*` family.

## What the product actually does

```ts
// packages/app/src/pages/workbench/design-canvas-tab.tsx:71-76
// The canvas lives in the workspace (`.unifia/design/`); localStorage keeps a
// safety copy when the server cannot be written and migrates older documents.
const repository = createWorkspaceDesignDocumentRepository(
  createSdkDesignFileStore(sdk.client.file as unknown as SdkFileClient),
  createLocalStorageDesignDocumentRepository(),
)
```

The workspace is the authority. The localStorage repository is a fallback used in
exactly two cases (`persistence/workspace-repository.ts:60-74`): the workspace read
**rejected**, or the workspace file is **absent** — in which case the local copy is
loaded once and then persisted into the workspace.

The document id is a hardcoded literal, `"canvas"`, in two places
(`design-surface.tsx:793`, `design-workspace.tsx:178`), so the document is stored at
`.unifia/design/canvas.design.json` — **one canvas document per workspace**.

## Defect 1 — the seed is ignored once a workspace document exists

Measured, immediately after the spec's own seed and navigation:

```
localEntryStillThere: true
localSchemaVersion:   1
localNodeIds:         ["f","a","b","r"]
localRootIds:         ["f","r"]
layerRowIds:          ["node-myclkciv","node-hsbky9vn","node-zexgi89p","node-ukiuo3ya",
                       "legacy-text","legacy-rect","a"]
```

The seed is **byte-for-byte intact and still `schemaVersion: 1`**, which is the
proof it was never loaded: had it been read, the migration would have stamped it
to 2 and `read()` would have persisted it into the workspace. Instead the panel
renders a *different* document — one with generated `node-*` ids plus
`legacy-text` and `legacy-rect`, which are the nodes `canvas-import.spec.ts`
creates. The workspace already held a canvas document, so it won and the seed was
discarded.

That makes the family **order- and history-dependent**, which is why
`canvas-layers.spec.ts:86` cannot find `[data-design-layer-visibility="r"]`:
the rendered document has no node `r`. The `directory` fixture is
`{ scope: "worker" }` (`e2e/fixtures.ts:309-313`), so every canvas spec a worker
runs shares one worktree — and the workspace outlives the run, which is why running
`canvas-layers.spec.ts` **alone** still failed (`e2e-canvas-alone.log`): "alone"
was not a clean slate.

## Defect 2 — the assertion oracle cannot see a real edit

`canvas-layers.spec.ts:60-84` and the import spec read state back with
`localStorage.getItem("unifia-design-document:v1:canvas")`. But the product
persists to the workspace, and only writes the localStorage copy when the
workspace write **fails** (`workspace-repository.ts:49-57`). So even with a correct
seed, a successful visibility toggle, lock, reorder or reparent is invisible to
these assertions, because the entry they read is the untouched seed. That is what
`canvas-import.spec.ts:39` reports: expected
`{rect, rootIds, schemaVersion: 2}`, read `null` after 30 s — nothing was ever
written to the key it watches.

This defect is independent of the first one: fixing the seed alone would not make
the persistence assertions capable of passing.

## What a fix has to do

Both sides move to the workspace store, and the specs become independent of
whatever a previous run left behind:

1. **Seed the workspace, not localStorage.** Write
   `.unifia/design/canvas.design.json` through the SDK the specs already have
   (`backend.sdk(directory)`), before navigating.
2. **Assert the workspace.** Read the same file back through the SDK instead of
   `localStorage.getItem`.
3. **Reset first.** Remove any existing canvas document at setup, or give each
   canvas spec its own worktree, so no spec depends on another's leftovers or on a
   previous run.

Seeding localStorage is not wrong in itself — it is the documented migration path
and the repository honours it when the workspace has no document. It is simply not
sufficient, and it is not an oracle.

## What I did not do *when writing this*

At the time of measurement I did not change the canvas specs, and I did not touch
the product. This is the third attempt on this family and the first two hypotheses
I took to the browser were wrong — I expected the seed to be schema-rejected, then
cross-spec contamination within a batch. Both were refuted by measurement, and the
contamination that does exist is across *runs* through the persistent worktree.
Shipping a seed rewrite then would have been the unmeasured change my own rules
warn against; the measurements above are what the rewrite needed.

## Resolution — closed by #264 and #265

The diagnosis was right and the provenance question resolved itself: the stale
document was the worktree outliving a run, exactly as the first hypothesis
predicted. Both defects are fixed and the family is green.

**#264 — seed and assert the store the product owns.** `canvas-import.spec.ts` and
`canvas-layers.spec.ts` now call `resetWorkspaceCanvas(directory)` before
navigating, so the documented migration path is actually taken, and they read the
workspace file from disk instead of reading `localStorage` back, because the
product only refreshes the local copy when a workspace write *fails*
(`persistence/workspace-repository.ts:49-57`). After #264 every functional
assertion in both specs passed and both failed only on the trailing console gate.

**#265 — a gate that can name its own exceptions.** `track()` sees only
`msg.text()`, and Chromium reports every failed resource identically with no URL,
so no text filter could distinguish the two expected 404s from a real fault.
Relaxing `t.logs` would have hidden *any* 404 for the rest of these specs,
permanently and invisibly. `trackFailingRequests(page)` instead records
`status method URL` for every response ≥ 400, and the specs gate on that. The two
tolerated requests are named in `BENIGN_HARNESS_404` with their reasons:
`POST /workbench-web/token`, which the app already turns into a dedicated
`WebWorkbenchBridgeUnavailableError` when the server has no password, and
`GET …/file/raw?path=…canvas.design.json`, the document's absence before first
load, which the repository treats as normal. Console errors other than
resource-404s still fail, and `t.pages` is untouched.

The filter was checked against six responses so the gate could not be a no-op: it
tolerates the two benign 404s and still reports a 500, a 401, an unrelated 404,
and a 404 on a different `file/raw` path.

```
dev@b1b38e6a6f, workers 1, retries 0, real backend, two independent runs
bun run test:e2e:local -- e2e/v110/canvas-layers.spec.ts e2e/v110/canvas-import.spec.ts
 2 passed (32.1s)
 2 passed (31.0s)
```

No product code was changed by either PR.

## Still open on this family

The rest of the suite was deliberately **not** swept onto
`trackFailingRequests`. Several specs probably hit the same two 404s, but which
ones is a measurement, not a guess — and guessing would repeat the mistake this
document exists to correct. That conversion is the next step for the family.

The systematic search for the #247 password anti-pattern across `packages/app/src`
came back negative: `serverBasicAuthorization` correctly returns `undefined` with
no password, and the web bridge correctly converts the 404 into a typed error.
`terminal.tsx` was the only occurrence, and it is fixed.
