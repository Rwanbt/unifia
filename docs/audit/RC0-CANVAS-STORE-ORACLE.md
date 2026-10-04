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

## What I did not do

I did not change the canvas specs, and I did not touch the product. This is the
third attempt on this family and the first two hypotheses I took to the browser
were wrong — I expected the seed to be schema-rejected, then cross-spec
contamination within a batch. Both were refuted by measurement, and the
contamination that does exist is across *runs* through the persistent worktree.
Shipping a seed rewrite now, on a family I have just spent three attempts
re-diagnosing, would be the unmeasured change my own rules warn against; the
measurements above are what the rewrite needs.

One honest limitation: this identifies the mechanism, not the provenance of the
stale `.unifia/design/canvas.design.json`. The worktree outliving a run is worth
confirming on its own, because if it is instead being seeded by another agent
working the same repo concurrently, the fix in point 3 changes shape.
