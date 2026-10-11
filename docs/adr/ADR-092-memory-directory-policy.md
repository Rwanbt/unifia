<!-- SPDX-License-Identifier: MIT -->
# ADR-092 — The memory vault stays inside its project; a configured location is the owner's choice

Status: **Accepted** for the default location. **Proposed** for a configured `memory.directory`: the owner decides (see *Open decision*).
Date: 2026-10-11

## Context

`openMemory` is the single entry point to the memory vault: the agent's tools (`memory_search`, `memory_read`, `memory_write`), the recall in the system prompt, the CLI and the server routes all open the vault through it.

The project-boundary check (a default vault must resolve inside its project) ran only in the server routes and in the CLI. The agent's write path and recall called `openMemory` directly and skipped it. Reproduced on `dev`: with `.unifia` linked to a folder outside the project, `openMemory({ writable, create })` created `memory/` in that folder and seeded the policy there. A repository that commits such a link redirects the agent's first note outside its project.

`memory.directory` is documented as: *"Relative paths resolve against the project root. Default: .unifia/memory. Point it at an existing Obsidian vault to use that vault as the memory."* A configured location therefore reaches a vault outside the project on purpose.

## Decision

1. **The default location is checked in `openMemory`**, before any read, create or cache lookup. Its deepest existing part (a dangling link counts as present, because creating through it would create its target) must resolve, on real paths, inside the project. Otherwise `VaultLocationRefused` is thrown. Its message names no path. Implemented in `packages/unifia/src/knowledge/app/project-boundary.ts`, reusing the containment primitives of `knowledge/source/containment.ts`.
2. **A refusal changes nothing.** Nothing is created, read, moved or deleted at the target. No existing file is moved.
3. **A configured `memory.directory` is the owner's explicit choice** and is not checked by rule 1. Its trust model is the open decision below.
4. The server routes and the CLI keep their names (`assertDefaultVaultInside`) and delegate to the same check.

## Usages checked

- Routes, CLI, agent tools and recall all reach the vault through `openMemory`.
- The desktop and the application do not set `memory.directory`; the only readers are the config schema, `openMemory` and the CLI and server, which resolve it through `resolveMemoryRoot`.
- The MCP knowledge server takes its workspace root from its caller, not from `.unifia`. It is outside this rule.

## Open decision (owner)

The project's own configuration file (`./opencode.json`) is part of the configuration cascade. A cloned repository can therefore set an absolute `memory.directory` and redirect the vault outside the project without the owner noticing. Relative values that escape the project (`../…`, or a link inside the project) raise the same question.

Options:

- **A (recommended).** Honour a location outside the project only from user-level configuration (`~/.opencode/config.json`, environment). Refuse it from project configuration, with a message that names the setting and not the path.
- **B.** Keep the current behaviour, and ask the owner once per project before a vault is redirected outside it (a trust record per directory).
- **C.** Keep the current behaviour and document the risk.

Option A needs the source of each configuration key, which the configuration service does not expose today. It is not implemented in this change.

## Tests

`packages/unifia/test/knowledge/app/project-boundary.test.ts`:

- the default vault inside the project is created as before;
- a first create through a link to a folder outside, and through a dangling link, is refused, and nothing is created at the target;
- a vault that is itself a link outside is refused; reading through such a link is refused too;
- the refusal message names no path;
- a link that stays inside the project is accepted;
- a configured location outside the project is accepted (pins the owner's choice above);
- with memory disabled, nothing is followed;
- a junction to a folder outside is refused on Windows (skipped on other platforms, not run in this change);
- a create under a folder of the vault that links outside is refused by the writer, and nothing is written at the target.

## Consequences

- Behaviour changes only for a default vault that resolves outside its project. Such a vault is refused on every surface, where before only the routes and the CLI refused it.
- A configured location behaves as before, and is the open decision.
- Migration: none. No file is moved or deleted.
- Residual risk: the check and the create are two steps. A link put in place between them, by a process that already writes into the project, is not covered by rule 1. The writer's per-file containment still applies inside the vault. Closing the window completely would need the directory opened by handle, which is not done here.
- A blank `memory.directory` is no directory: the default location is checked, as `resolveMemoryRoot` resolves it.
