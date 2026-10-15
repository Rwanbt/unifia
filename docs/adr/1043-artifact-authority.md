<!-- SPDX-License-Identifier: MIT -->

---
id: 1043
title: Artifact authority and the artifact-stack dispositions
status: PROPOSED
date: 2026-10-15
related: [0005, 0030, 1026, 1035, 1036, 1037, 1039]
---

# ADR-1043: One shipped artifact authority, five deferred packages named

## Context

RC-1 lot PW08 (#572) asked to close the artifact stack: five workspace
packages are classified `deferred-runtime` in
`scripts/package-wiring.json` — `@unifia/artifact-store`,
`@unifia/artifact-studio`, `@unifia/document-packs`,
`@unifia/generative-ui-dom` and `@unifia/mcp-ui-actions` — all with the
same one-line reason: a tested engine with no importer in shipped code.

The gate that produced that classification is right about the fact and
silent about the decision: `scripts/check-package-wiring.mjs` proves a
package is unreachable from the shipped roots
(`@unifia/app`, `unifia`, `@unifia/desktop`, `@unifia/desktop-electron`,
`@unifia/mobile`), never which of the two dispositions applies — "wire
it" or "leave it out on purpose". Left as-is, the manifest reads as five
unfinished tasks.

Meanwhile the product already ships an artifact path, and it was dead
once: `packages/workbench-server/src/bootstrap.ts:268-276` records that
nothing constructed the artifact store, so every `artifact.*` route
answered 503 in the shipped app until `artifactStoreResolver` was wired.
The routes now resolve a real store.

## Decision

**1. The canonical shipped artifact authority is
`@unifia/artifact-runtime`'s `ArtifactStore`.** It is reached in
production through exactly one assembly: the sidecar
(`packages/unifia/src/server/workbench.ts`, shipped root `unifia`)
configures `createWorkbenchApp({ artifactRoot: Global.Path.data })`,
and `packages/workbench-server/src/bootstrap.ts` turns that root into a
per-workspace `ArtifactStore` via `artifactStoreResolver`. The
production entry point is the Workbench HTTP surface: `POST
/v1/artifacts`, `GET /v1/artifacts`, `GET /v1/artifacts/:id/history`,
`GET /v1/artifacts/:id/raw/*`, `POST /v1/artifacts/export`, `POST
/v1/artifacts/:id/present` (`packages/workbench-server/src/server-dispatch.ts`
and `handlers/artifacts*.ts`). The Design surface — create, export,
share links, present, `Open in Code` — is the first shipped consumer and
goes through those routes only.

**2. `@unifia/artifact-store` is superseded for the shipped path.** It
implements the ADR-005 contract shape (`ArtifactRef` handle,
`ArtifactRecord`, store-side derivation of classification/taint/
digest) as an in-memory scaffold with a placeholder
`AtRestProtectionEnvelope`, and no shipped code imports it. Wiring it
next to `artifact-runtime` would create the second storage authority
this decision exists to prevent; the ADR-005 *contract* stays the
reference wherever those types are used, but the storage authority is
`artifact-runtime`.

**3. `@unifia/artifact-studio` and `@unifia/document-packs` are
deferred, post-RC-1.** The document pipeline (docx/pdf/pptx/xlsx
workers, `stripFormatMetadata`, golden hashes) is exercised by
`packages/release-hardening` gates and by its own tests. No RC-1
production surface produces those formats through it: the Design export
goes through the Workbench artifact routes of decision 1. Deferring is
a scope statement, not a quality claim.

**4. `@unifia/generative-ui-dom` and `@unifia/mcp-ui-actions` are
deferred, post-RC-1.** Neither has an importer outside their own tests;
`@unifia/mcp-ui-actions` is additionally read by the release-hardening
gates for its action registry and refusal audit, which is out-of-band
qualification, not a shipped path. The MCP UI surface they belong to is
not part of the RC-1 scope.

**5. The manifest carries the disposition.** Each of the five entries in
`scripts/package-wiring.json` now names its decision (superseded /
deferred post-RC-1) instead of the generic "no importer" sentence, so
the reachability gate stays green while the reason answers "on purpose".

Wiring any of the five later requires a new ADR plus a reachability
proof from a shipped root with a real consumer and E2E — the manifest
entry is removed when that proof exists, not before.

## Consequences

- No product code changes in this ADR: the shipped authority is already
  wired and tested.
- Evidence for the authority, at the point the issue asked for:
  persistence, versioning and the prior-version read are covered by
  `packages/artifact-runtime/test/artifact.test.ts` (lineage creation,
  history, both revisions readable, dedupe, scanner rejection leaving
  nothing behind, provenance); the shipped HTTP surface is covered by
  `packages/workbench-server/test/server.test.ts` (list, detail,
  history, revision to v2, export, raw read with its Content-Type
  policy and `nosniff`) and `packages/workbench-server/test/artifact-isolation.test.ts`
  (a workspace cannot read another workspace's artifacts, including
  through the raw route).
- One authority is a constraint, not a description: a second artifact
  store reaching shipped code now contradicts a ratified ADR.
- The five packages remain built and gated by CI as engines; "deferred"
  changes what may import them, not whether their suites run.
