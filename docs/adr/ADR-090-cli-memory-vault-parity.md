<!-- SPDX-License-Identifier: MIT -->
# ADR-090: The knowledge CLI reads the memory vault that the server reads

**Date**: 2026-10-11 | **Status**: Accepted (owner mandate, production readiness, D2)

## Context

The Memory panel and the agent's memory tools open the vault through `openMemory`: the default location is `.unifia/memory` under the project root, or the `memory.directory` setting when the owner configured one. The `unifia knowledge` CLI composed two other places: `<workspace>/memory` as the personal space, and the workspace root as the project space, excluding `memory/`. The `.unifia/` directory is hidden from that scan, so the CLI never saw the vault. `knowledge status` reported no note beside a server that listed one.

The `policy` subcommands had the same split. They read and wrote `<workspace>/.unifia/policy.json`, while the server reads the vault's own policy at `<vault root>/.unifia/policy.json`. A `policy set-egress` therefore changed a file that no surface consulted.

## Decision

1. **One resolution.** The CLI opens a workspace's vault the way the server opens the same directory: the project root is `Instance.worktree`, the settings are `Config.get().memory`, and a default location is refused when it resolves outside the project (`assertDefaultVaultInside`, moved to `server/knowledge-authority.ts` so both surfaces call one function). The vault is then opened by `openMemory`.
2. **Absence is a state.** `openWorkspace` returns `open`, `absent` or `disabled`. A missing vault is reported as "no memory vault at <path> yet", never as an empty vault with zero findings. A workspace that does not exist is still refused.
3. **The policy follows the vault.** `policy show` and `policy set-egress` / `set-feature` read and write the vault's policy file, and `show` prints the vault path.
4. **Explicit roots stay for tests and the evaluation corpus.** `openVaultRoot` composes a directory as a vault root without reading the configuration. The application never calls it.

## Rejected alternatives

- **Mirror the notes into the workspace root.** Two stores, one of them derived, and no way to tell which one an owner edited.
- **Read both `<workspace>/memory` and `.unifia/memory`.** That merges two conventions silently. The server and the panel have never read `<workspace>/memory`, so keeping it in the CLI would keep a view that no other surface shows.
- **Let a read create the vault when it is missing.** A read must not bring a directory into being. Only a write creates a vault: a proposal from the panel, or a `policy` write that the owner asked for.

## Consequences

- A workspace that kept notes in `<workspace>/memory` is no longer read by the CLI. The files are not deleted. The Memory panel never showed them either; to govern them, move them into the vault with the governance frontmatter (see the adoption decision, which is the owner's).
- `policy set-egress` now changes the vault's policy. A vault that has no policy file yet gets the built-in default when it is read; writing a policy creates `.unifia/policy.json` inside the vault directory.
- Other `unifia knowledge` subcommands (`portable`, `reachability`, `classify`, `gc`, `summary`, `report`) still take a directory as the vault root. This is the V1 convention and is not changed here; it is recorded in `docs/production/GAP-REGISTER.md` before any of them is called a production surface.
- The CLI now imports a helper from `server/knowledge-authority`. That module holds no HTTP code; keeping the containment check in one place is worth the import.

## Verification

- `test/knowledge/cli/vault-parity.test.ts`: the same note, persisted once, is answered by `status` and `search` on the CLI and by `/knowledge/status` and `/knowledge/search` on the server, for the default location and for a configured `memory.directory`. A project without a vault is reported as absent by both.
- `test/knowledge/cli/search.test.ts`: the vault is the one the application reads; notes loose at the workspace root and in a `memory/` folder are not read; a vault policy denial holds; a default vault reached through a junction outside the project is refused (`VaultLocationRefused`).
