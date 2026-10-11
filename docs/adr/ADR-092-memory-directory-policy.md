<!-- SPDX-License-Identifier: MIT -->
# ADR-092 — The memory vault stays inside its project; a configured location is the owner's choice

Status: **Accepted**, for the default location and for a configured `memory.directory` (option A, see *Decision on the configured location*).
Date: 2026-10-11

## Context

`openMemory` is the single entry point to the memory vault: the agent's tools (`memory_search`, `memory_read`, `memory_write`), the recall in the system prompt, the CLI and the server routes all open the vault through it.

The project-boundary check (a default vault must resolve inside its project) ran only in the server routes and in the CLI. The agent's write path and recall called `openMemory` directly and skipped it. Reproduced on `dev`: with `.unifia` linked to a folder outside the project, `openMemory({ writable, create })` created `memory/` in that folder and seeded the policy there. A repository that commits such a link redirects the agent's first note outside its project.

`memory.directory` is documented as: *"Relative paths resolve against the project root. Default: .unifia/memory. Point it at an existing Obsidian vault to use that vault as the memory."* A configured location therefore reaches a vault outside the project on purpose.

## Decision

1. **The default location is checked in `openMemory`**, before any read, create or cache lookup. Its deepest existing part (a dangling link counts as present, because creating through it would create its target) must resolve, on real paths, inside the project. Otherwise `VaultLocationRefused` is thrown. Its message names no path. Implemented in `packages/unifia/src/knowledge/app/project-boundary.ts`, reusing the containment primitives of `knowledge/source/containment.ts`.
2. **A refusal changes nothing.** Nothing is created, read, moved or deleted at the target. No existing file is moved.
3. **A configured `memory.directory` is trusted only by its source.** A location inside the project is honoured as written. A location outside the project is honoured only when the user's own configuration names the same place, on canonical paths; otherwise it is refused with `MemoryDirectoryRefused`, whose message names the setting and not the path. Rule 3 is decided in `packages/unifia/src/config/memory-trust.ts`, and every surface that opens the vault gets its settings from `trustedMemorySettings`.
4. The server routes and the CLI keep their names (`assertDefaultVaultInside`) and delegate to the same check.

## Usages checked

- Routes, CLI, agent tools and recall all reach the vault through `openMemory`.
- The desktop and the application do not set `memory.directory`; the only readers are the config schema, `openMemory` and the CLI and server, which resolve it through `resolveMemoryRoot`.
- The MCP knowledge server takes its workspace root from its caller, not from `.unifia`. It is outside this rule.

## Decision on the configured location (owner, option A)

The project's own configuration file (`./opencode.json`) is one layer of the configuration cascade. A cloned repository could set an absolute `memory.directory` and redirect the agent's memory outside the project, so a repository would grant itself authority over a folder the owner never named.

Decided by the owner: a location outside the project is honoured only from the user's own configuration, and only the place it names.

How it is implemented, and why it does not need per-key provenance from the configuration service:

- The merged value is compared with the user-level value (`Config.getGlobal()`), on canonical paths. A location outside the project is honoured only when both name the same place. The project file cannot grant a location the user did not name.
- A location inside the project is honoured as written, relative or absolute, whatever configuration names it. Its path is judged by where it is, so a link inside the project that leads outside counts as outside.
- The user's own Obsidian vault, named in the user configuration, keeps working.
- A location named outside by an environment variable only is refused too, unless the user configuration names the same place. Users who relied on the environment for an outside vault must move the setting to their user configuration. This is the one behaviour change for them.
- Refused, the surface returns an error (the routes return 403) or recalls nothing that turn; the refusal is logged without the path.

Options that were not taken: **B**, a trust record per directory asked of the owner once per project, is more interactive and leaves a question open for every new project; **C**, keep the behaviour and document the risk, leaves a cloned repository able to redirect the agent's memory.

## Windows

Windows has no `O_NOFOLLOW`: an open follows a symbolic link at its last component. Where the platform has no flag, `packages/unifia/src/knowledge/mutation/durability.ts` looks first, with `lstat`, and refuses a link:

- `readNoFollow`, `writeNewFileDurable` and `appendLineDurable` call `isLinkNow` before they open the path. Where `O_NOFOLLOW` exists, `isLinkNow` returns false and the open refuses the link itself.
- An exclusive create (`wx`) at a dangling link creates the link's target, outside the vault. This is why `writeNewFileDurable` looks before it creates. A probe on Windows CI showed it, and the Windows link tests failed on `ffba387f5` and `901ab90c3`, before the look was added.

Verified: the `unit (windows)` job of PR #489 on head `e9dddc177` (job 114576535492) completed with success. It runs `test/knowledge/mutation/link-containment.test.ts`, including "a temporary planted as a dangling link is not written through", "a trashed note replaced by a link is not restored", "a trash entry whose sidecar is a link is not listed" and "a sidecar that is a link is refused". It also runs the Windows-only junction test in `test/knowledge/app/project-boundary.test.ts`.

Residual, stated plainly:

- The look and the open are two steps. A process of the same user that replaces a file inside the project with a link between the `lstat` and the open can still redirect a read or a write. The look narrows the gap; it does not close it. Closing it needs an open that refuses links on the platform, which this change does not have.
- A directory junction to a folder outside the project is refused by the realpath containment check, not by the `lstat` look. Whether `lstat` itself reports a junction as a link was not checked here.
- Windows was not run locally. The results above come from the CI job.

## Tests

`packages/unifia/test/config/memory-trust.test.ts` (the decision, on real directories and links):

- no location named: the default vault;
- a relative or absolute location inside the project is honoured;
- a location outside the project named only by the project is refused, including one reached by `../` and one reached through a link inside the project;
- a location outside the project that the user's configuration names as well is honoured, including through a link to it;
- a location the project names outside is refused when the user names another place, or a place inside the project.

Not covered by a unit test: `trustedMemorySettings`, the thin read of `Config.get()` and `Config.getGlobal()`. It is exercised through `decideMemoryDirectory` and needs a configuration fixture with a user-level file, which is a follow-up.

`packages/unifia/test/knowledge/app/project-boundary.test.ts`:

- the default vault inside the project is created as before;
- a first create through a link to a folder outside, and through a dangling link, is refused, and nothing is created at the target;
- a vault that is itself a link outside is refused; reading through such a link is refused too;
- the refusal message names no path;
- a link that stays inside the project is accepted;
- a configured location outside the project is accepted by `openMemory` itself, which takes an already-trusted setting (the trust decision is made above it, in the next file);
- with memory disabled, nothing is followed;
- a junction to a folder outside is refused on Windows (skipped on other platforms, not run in this change);
- a create under a folder of the vault that links outside is refused by the writer, and nothing is written at the target.

## Consequences

- Behaviour changes only for a default vault that resolves outside its project. Such a vault is refused on every surface, where before only the routes and the CLI refused it.
- A configured location inside the project behaves as before. A configured location outside it behaves as before only when the user's configuration names it; a project-only or environment-only outside location is refused.
- Migration: none. No file is moved or deleted.
- Residual risk: the check and the create are two steps. A link put in place between them, by a process that already writes into the project, is not covered by rule 1. The writer's per-file containment still applies inside the vault. Closing the window completely would need the directory opened by handle, which is not done here.
- A blank `memory.directory` is no directory: the default location is checked, as `resolveMemoryRoot` resolves it.
