<!-- SPDX-License-Identifier: MIT -->
# Sovereign Knowledge Core V1 — Permissions and Egress

> Single source of truth for what the Sovereign Knowledge Core
> V1 is allowed to read, write, and emit, and to whom.
> See also: ADR-KNOW-0006 (egress: default deny), ADR-KNOW-0007
> (native port), ADR-KNOW-0004 (Class C: local only, never Git).

## 1. Default posture

**Default deny.** Every egress path is closed by default. Opening
one requires a typed `DeclassificationGrant` bound to a hash, a
destination, and a TTL. No global "send everything" mode exists.

The runtime cannot read or write outside the workspace root
(`<workspace>`) without an explicit `mount` declaration recorded
in the Class C control store.

## 2. Capability surface (V1)

The Sovereign Knowledge Core V1 exposes exactly these capabilities
to the rest of Unifia. They are exhaustively listed in
`packages/contracts/src/knowledge/mcp.ts` (`MCP_KNOWLEDGE_METHODS`):

| Capability | Direction | Default | Notes |
|---|---|---|---|
| `knowledge_search` | read | allow (in-workspace) | bounded by ADR-KNOW-0007 |
| `knowledge_get` | read | allow (in-workspace) | id-based |
| `knowledge_backlinks` | read | allow (in-workspace) | id-based |
| `knowledge_trace` | read | allow (in-workspace) | provenance chain |
| `knowledge_status` | read | allow | always local, no payload |
| `knowledge_propose` | write (Class A) | allow with provenance | requires intent |

Any capability not in this list is not implemented and must not be
invoked. There is no `knowledge_*_admin` or `knowledge_*_raw` in V1.

## 3. Egress destinations

A `destination` is one of:

| Destination kind | Examples | Default | Override |
|---|---|---|---|
| `provider:<id>` | local llama.cpp, local ONNX | allow | allow |
| `provider:<id>:remote` | OpenAI, Anthropic, any cloud LLM | **deny** | declassification grant required (per hash + TTL) |
| `git_remote:github` | push to GitHub | **deny** for `git_remote: deny` items | grant |
| `git_local` | local `.git/` | allow (outgoing range is scanned) | n/a |
| `mcp:remote` | remote MCP server | **deny** | grant |
| `mcp:local` | local MCP server (loopback) | allow | n/a |
| `file:outside_workspace` | any path outside `<workspace>` | **deny** | grant |
| `file:inside_workspace` | any path inside `<workspace>` | allow | n/a |

## 4. Restrictions per source

A note may carry a `portable_restrictions` block in its frontmatter:

```yaml
unifia_id: 0190d2c0-7b00-7000-8000-000000000001
unifia_type: constraint
unifia_lifecycle: active
unifia_project_ref: unifia

portable_restrictions:
  remote_model: deny        # never go to a remote LLM
  local_model: allow        # may go to local llama.cpp / ONNX
  git_remote: deny          # never push to a remote
  external_editor: allow    # may be edited outside Unifia
  mcp: deny                 # never emit through MCP
```

The `ContextRouter` enforces these restrictions **before**
hydrating a `ContextPack`. Denied items are dropped and reported
in `ContextDiagnostics.droppedByEgress`.

## 5. Tokens and quotas

Each MCP session receives a token with:

- a workspace scope (single workspace);
- a TTL (default 1 hour, max 24 hours);
- a method allowlist (subset of the 6 capabilities above);
- a request quota (default 60 req/min, max 600 req/min);
- a byte cap per response (default 1 MiB, max 8 MiB).

A revoked token is rejected immediately, even mid-session. There
is no anonymous MCP access in V1.

## 6. Audit trail

Every cross-class mutation, every egress decision, and every
admin task emits a record to the Class C control store. The
control store is **local only** and never pushed to a remote.

## 7. What V1 does not do

- It does not call any remote LLM unless the user has explicitly
  granted a `DeclassificationGrant` for the relevant hash.
- It does not push to any Git remote. `autoPush` defaults to
  `false` (see `GitProvider`).
- It does not sync to any cloud. There is no Unifia cloud in V1.
- It does not phone home. The `sovereignty` command rejects
  environments that report `internet=on` or `cloud=on`.
- It does not embed any third-party tracking, analytics, or
  telemetry.

## 8. Operator-facing commands

| Command | Purpose |
|---|---|
| `unifia knowledge sovereignty` | run the 4 sovereignty probes |
| `unifia knowledge disaster-recovery` | plan the recovery procedure |
| `unifia knowledge migrate --dry-run` | preview a migration |
| `unifia knowledge migrate --rollback` | preview the rollback plan |
| `unifia knowledge precommit install <ws>` | install the secret-scan hook |
| `unifia knowledge precommit scan <files...>` | run the scan manually |

## 9. How to change this document

`PERMISSIONS.md` is part of the V1 contract. Any change must:

1. be preceded by an ADR in `docs/knowledge/adr/` updating the
   relevant knowledge ADR (KNOW-0006, KNOW-0007, KNOW-0009);
2. be reviewed by the operator and recorded in `DECISIONS.md`;
3. not relax the default-deny posture without an explicit
   migration step and operator approval.

No automatic edit of this document by an AI agent is allowed.
