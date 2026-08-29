<!-- SPDX-License-Identifier: MIT -->
# Changelog — Sovereign Knowledge Core V1

> All notable changes to the Knowledge subsystem are documented
> here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0-knowledge] - 2026-08-29

### Added
- **`@unifia/contracts/knowledge/`** : 10 fichiers, 37 tests Zod.
  Identity (UUIDv7, locator, hash), space (4 kinds), restrictions
  (remote/local/embeddable/exportable), lifecycle (4 states,
  9 types), retrieval (bounded), mutation (8 kinds with
  intent completeness), context (ContextPack), native-port
  (7 methods), errors (11 typed kinds), MCP (6 capabilities).
- **`packages/unifia/src/knowledge/`** : 21 modules
  - `domain/` : `KnowledgeFailure` with 11 typed kinds.
  - `parser/` : YAML frontmatter (gray-matter + strict Zod),
    wikilinks (`[[X]]`, `[[X|Y]]`, `[[X#H]]`), headings,
    section slicer, fenced code blocks.
  - `source/` : `KnowledgeSource` interface + `SourceRegistry`
    + 4 V1 spaces (Personal, Project, External, Session).
  - `policy/` : `decideEgress` honouring ADR-KNOW-0006.
  - `context/` : `ContextRouter` (per-type cap, token
    budget), `inspect()` (read-only), `classifyText` (secret
    detection).
  - `derived/` : SQLite+FTS5 DDL (V1 migration, additive),
    `chunkBody`, `extractEdges`, `indexNote`.
  - `admin/` : `doctor()` with 11 categories.
  - `memory/` : lifecycle transitions, auto-promotion,
    Inbox.
  - `semantic/` : `cosine`, `BruteForceIndex`, embedding
    scoring per runbook §8.8, benchmark.
  - `stack/` : ai-native-dev-stack source mapping
    (9 source kinds, copy-on-write `StackMapping`).
  - `facade/` : `KnowledgeService` shared by Code/Work/Design.
  - `git/` : `GitProvider` + pre-push secret scan.
  - `mcp/` : `McpKnowledgeServer` with rate limit + byte cap.
  - `mobile/` : `STORAGE_MATRIX_TEMPLATE` (4 kinds), Android
    device probe.
  - `events/` : `DomainBus` (10 event kinds).
  - `cross-mode/` : `CrossModePipeline` (Design → Code → Work).
  - `hardening/` : `CRASH_SCENARIOS` (6), sovereignty checks,
    path containment, fuzz with xorshift32, large vault
    simulator, SBOM walker (CycloneDX 1.5).
  - `wal/` : TS adapter of the Rust WAL.
  - `classb/` : TS adapter of the Rust Class B.
  - `control/` : TS adapter of the Rust ControlStore.
  - `spike/` : P0 spike primitives (callBounded,
    ATOMIC_WRITE_MATRIX, sandbox, FTS probe, prepush, synthetic
    retrieval).
- **`crates/unifia-knowledge-core/`** : 8 modules Rust, 18 tests.
  - `error` : `KnowledgeError` (11 kinds, snake_case).
  - `hash` : BLAKE3 + SHA-256, 64-char hex validation.
  - `path` : `ResolvedKnowledgePath` with symlink/junction
    containment.
  - `watcher` : debounce/coalesce primitive, `hash_file`.
  - `wal` : append-only WAL with 8 kinds, idempotent replay.
  - `classb` : copy-on-write aliases, reachability report, GC.
  - `control_store` : Class C (device_id, PolicyGrant,
    EgressGrant, control log).
- **`bin/unifia-knowledge.ts`** : CLI surface (status, sources,
  search, doctor, bench, bench-large).
- **9 ADR** at `docs/knowledge/adr/0001..0009-knowledge-*.md`
  (identity, canonical, Class B, Class C, Class D, egress,
  NativePort, search, lifecycle).
- **10 cas réels** dans `PRODUCT-CASES.md` (PC-01..PC-10)
  extraits de `KNOWN_FAILURE_PATTERNS.md` et `KNOWN_ISSUES.md`.
- **DoD** : 12 user-level + 10 engineering-level requirements.
- **22 fixtures** : 11 dev + 11 holdout, isolation validée par
  `check-isolation.ts`.

### Validation
- 255 tests passants : 168 TS knowledge + 69 contracts + 18 Rust.
- Typecheck `bun run typecheck` (packages/unifia) : exit 0.
- `cargo clippy --all-targets --all-features -- -D warnings` : exit 0.
- `biome check packages/unifia/src/knowledge` : 0 warning.

### Status
- Branch : `feat/sovereign-knowledge-core`
- HEAD : `ef11945cdc`
- 24 commits, 130 files added, ~13 000 insertions.
- 0 push, 0 PR, 0 merge, 0 release, 0 publication.

### External boundaries
- Android device : `NOT_EXECUTED_EXTERNAL_BOUNDARY` (P10.2 / P10.3).
- ONNX embedding model : `disabled` by default.
- Frontier review : not triggered (runbook §24).
