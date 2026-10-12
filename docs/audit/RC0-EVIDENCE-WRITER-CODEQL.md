<!-- SPDX-License-Identifier: MIT -->
# RC-0 evidence writer CodeQL trace

Reviewed: 2026-10-03, dev `9f69f9c670d958a6443452c53fb5ffb632dbb29a`.
Alert #615: `js/http-to-file-access`,
`packages/automate-m0-harness/src/qualification/evidence-writer.ts:21`.

## Finding and proposed disposition

The tainted HTTP responses become evidence **content**, not a filesystem
destination. The reported calls write JSON observations to a fixed
`result.json` beneath an operator-selected qualification output directory.
Proposed disposition for this specific flow: false positive. No alert has
been dismissed, query excluded, or production writer changed.

## Producer to filesystem

1. `multiprocess-fc14-real.ts` starts two qualification processes and reads
   their claim/mutation/dispatch responses through HTTP. Claim objects and
   derived HTTP status observations are included in the evidence object.
2. Before those responses, it computes `folder` with
   `evidencePath(outputRoot, "DBOS_GO_SQLITE", "FC-14")`. The output root is
   supplied by the qualification caller, not read from the HTTP response.
3. `multiprocess-fc14.ts` uses the same construction for FC-14 and FC-25;
   the shared writer's three call sites all pass the literal `result.json`.
4. `result.ts:evidencePath` joins the output root with `evidence`, a typed
   candidate slug and the criterion. The response cannot select these values.
5. `evidence-writer.ts` joins its first two arguments for the destination,
   then serializes its third argument as JSON (or preserves string content).
   Response fields named `path` or `filename` remain JSON fields.

Repository search: `rg -n 'writeEvidence' packages/automate-m0-harness`.
The runner has a separate local writer; its imported shared writer is unused.
This trace does not treat that unused import as an active data path.

## Executed evidence and limits

From `packages/automate-m0-harness`:

- `bun test test/evidence-writer.test.ts`: 2 passed, 0 failed, 7 assertions,
  43 ms. Real temporary files prove traversal-shaped response fields and
  response text do not redirect the destination or create sibling files.
- `bun run typecheck`: exit 0.

These tests qualify the writer's content/path separation. They do not run
the complete multi-process qualification, establish safe arbitrary caller
paths, protect against a local filesystem attacker, or qualify release QA12R.
The generic writer still trusts its `fcFolder` and `filename` arguments;
any new network-controlled caller must validate those before using it.
