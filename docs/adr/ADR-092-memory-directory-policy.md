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

- The look and the open are two steps, so a window remains between them. The look narrows the gap; it does not close it. Closing it needs an open that refuses links on the platform, which this change does not have.
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
- Residual risk, confirmed and not closed: the containment check of a note's folder and the write are two steps, so the folder can change between them. The reproduction is shared with the owner privately. Closing it needs an open relative to a directory handle, which Node does not offer here; it is not done in this change.
- A WAL or a policy file with a second name (for example a backup made with hard links) is refused: the vault does not open until the second name is removed. Before this change the WAL was read as empty, which reset the sequence and hid committed writes.
- The vault's own folder is never a create, move or recovery target. The trash is the one place of it a restore reads from.
- A configured location whose internal link leads outside is refused, as `openMemory` has always done: the internal links of a configured vault must stay inside it.
- A write or a read of a name Windows reserves for a device (`CON`, `NUL`, `COM1` and so on, with or without an extension) is refused on Windows.
- A blank `memory.directory` is no directory: the default location is checked, as `resolveMemoryRoot` resolves it.
- The memory tools (the agent's surface) read notes through the handle-checked reader, and refuse a note with a second name. The `admin` commands and the classb reachability index still read some notes by name, and follow a link inside the vault. They are the owner's own commands, reached from the CLI; moving them to the handle-checked reader is a separate change.
- On Windows, the recovery scan refuses symbolic links, but does not yet refuse directory junctions the same way.
- The source of a committed move is unlinked by the writer under the write lock. Recovery finishes that unlink only when a writer died mid-commit, which the write lock still on disk at open shows. Before, every open did it, so identical bytes written back at the old path were removed silently.
- A pending temporary of a note that a later move takes away is still completed beside the moved note, as before: the source of a move is not a newer write. Not changed here.
- Recovery folds the case of a name on Windows and macOS. On a case-sensitive macOS volume, two notes whose names differ only in case are treated as one; the outcome needs identical bytes and a pending temporary, and is not closed here.

## Independent review of head `75264c717` (2026-10-12): confirmed defects, and their resolution

An independent review, then a reproduction of each claim on this head, found the defects below. The residual statements above that these contradict are corrected here: the source-of-a-move statement is true only while the stale lock is reclaimed at open, which it is not; and the delete case was not described at all. Each item was to stay open until a deterministic regression test failed on the head and passed after its fix. The resolution follows the table.

| # | Severity | Confirmed by | Defect |
|---|---|---|---|
| R1 | high | one process: crash, user edit, reopen | Recovery renames a pending temporary over a destination that holds bytes other than the pre-write bytes, so a user edit made after the crash is replaced. |
| R2 | high | one process: delete, reopen | A later delete does not suppress completion of an earlier pending temporary; the deleted note returns with the failed write's bytes. |
| R3 | high | one process: move, reopen | A later move does not suppress completion; the moved note loses its committed write, which reappears at the old locator. |
| R4 | high | one process: crash after a move, reopen twice | The pass that unlinks a move source runs on every open while a stale write lock remains, so a source the user recreates byte-identical is removed on the next open. |
| L1 | high | two processes, concurrent updates | The expected-hash check runs outside the write lock; both processes can pass it on the same version and both commit. Reproduced: 142 committed updates, one previous hash with two commits. In one process the second update is refused, as it should be. |
| L2 | high | one process, a FIFO at the lock path | The lock file is read without the no-block open, so `apply()` never returns. Reproduced: no completion after 15 s. |
| L3 | medium | one process, a FIFO named `*.md` in the vault | The listing throws on that note, so the whole space's listing fails. Reproduced. |
| L4 | medium | one process, a WAL with a `null` line | The writer's constructor throws on the line, so the vault does not open. Reproduced. |
| L5 | medium | one process, a `null` line in the control log | The audit tally throws. Reproduced. |
| L6 | medium | two openers, a live writer mid-commit | Recovery in the constructor runs without the lock and discards a live holder's temporary. Reproduced. |
| L7 | low | an in-vault alias to the trash | An update through the alias rewrites the trash entry; the writer's locate path lacks the internal-locator refusal that `resolveWritable` applies. Reproduced. |
| L8 | medium | audit rotation | Rotation replaces the earlier rotated generation. Reproduced. Whether one generation is the intended design is a decision for the owner. |
| L9 | plausible | a rename that fails | A failed rename leaves a temporary and a committed WAL line; later writes to that note are refused until reopen. Not reproduced. |
| L10 | plausible | lock reclaim | The reclaim reads the pid and unlinks the lock without an identity check, so a lock taken in between can be removed. Pid liveness is host-local. |

The crash fixtures in `writer-atomicity.test.ts` leave a temporary beside a destination that already holds the bytes, which an atomic rename never leaves. A realistic state gives `completed` 0, not 1. Those fixtures are unchanged and still pass: a destination that already holds the new bytes is the "already landed" branch, which drops the leftover and counts it completed. The realistic states are covered by the new fixtures in `containment-review-regressions.test.ts`.

Windows search: `GET /knowledge/search` failed on Windows at `ade0032c3` (CI shows no assertion text). The code on that path does not reach the changed guards. The search runs under a 10 s deadline, and a deadline hit returns `truncated: true` with fewer items. The cause is not established; the test will assert `truncated: false` first so that the next failure names it.

### Resolution on `fix/memory-vault-containment` (2026-10-12)

One commit per item. Each has its regression in `test/knowledge/mutation/containment-review-regressions.test.ts`. "On 43a46b550" is the result of that test file run against a clean checkout of that commit.

| Item | Commit | Failure on 43a46b550 | Fix |
|---|---|---|---|
| L2 | e7235d086 | The child stops after "opened", with no "finished" within 20 s. | The lock is read through the no-follow, non-blocking reader. A lock that is not a file of its own is held, never reclaimed. |
| R1 | b31e85c81 | The user edit made after the crash is replaced by the pending bytes. | A temporary completes over a destination only if the destination is absent (create, move, restore) or holds the update's previous hash. Otherwise it stays in place, and `RecoveryReport.conflicts` names it. |
| R2, R3 | e176b7055 | A delete, or a move away, made after a failed rename: the note reappears with the pending bytes at its old path. | The newest WAL entry that touches the note decides: a write at it, a delete of it, or a move away from it. A temporary completes only when that entry is the write whose bytes it holds. A stale temporary is dropped only when the note already holds the newest committed bytes. Any other temporary is kept as a conflict. |
| R4, L6 | 33e0f4039 | On the second open, the source the user recreated byte-identical is removed. A live holder's in-flight temporary is discarded, or completed. | The open takes the write lock for recovery. Only a reclaim of a dead or stale holder's lock counts as a crash, so the move-source pass runs only then. A live holder keeps the lock and recovery is left to it. Releasing the lock removes the crash marker, so it is consumed once. |
| L4 | 0dc508368 | A `null` line throws a TypeError from the constructor. A move whose `previousLocator` is not a string throws in the move-source pass. | A line that is not an object is set aside and counted as malformed. The move-source pass passes over a `previousLocator` that is not a string. |
| L7 | 2ee998ca2 | An update through an in-vault alias to the trash rewrites the trashed note. A supersede naming it as successor does too. | `locate` judges a note by its real place and refuses the vault's own folder, as `resolveWritable` does. The synchronous walk passes over that folder by its real place. |
| L10 | 0c4785489 | A lock written by a live writer between the judgement and the unlink is removed, and the acquire succeeds. | The reclaim re-reads the lock through the no-follow reader and removes it only when its text is unchanged. `WriteLock` takes an `afterJudgement` hook, which the test uses to make the window deterministic. |
| L1 | 506fdd7f1 | A stale update is committed on top of a version another writer has replaced. The two-process run has duplicate previous hashes. | `commit` and `remove` re-check, under the lock and before the WAL line or the trash copy, the state the write was planned against. A mismatch is refused with the same `cas_mismatch`. The owner's two-process repro reports 0 previous hashes with two commits; it reported 1. |
| L9 | 4ccddd1ea | Later writes to the note are refused with "a file is already present" instead of the stale-version refusal. | A write completes a leftover temporary at its name under the lock, through the recovery an open runs, before it checks its own expected state. |
| L4, second reader | c4cdc3233 | Found by grepping the L4 pattern. A trash sidecar of `null`, a number or an array throws a TypeError out of `restoreDeleted`; a sidecar that is not JSON throws a SyntaxError. | The sidecar's locator is read only from an object with a string locator. Anything else is refused as nothing in the trash, the refusal a missing sidecar gets. |

Decisions for the owner:

- **Changed expectation** in `third-review-regressions.test.ts`, "a delete after a committed write does not discard the write's temporary". It asserted completion of the temporary over the note. That is R2 (a later delete undone by a failed write's bytes), and it also overwrote a destination holding other bytes (R1). The title's property holds: the temporary is kept, not discarded. Completion cannot hold under R2 on any state the writer records, and the fixture's update carries a null previous hash, which the writer never records for an update. The test now asserts: not completed, reported as a conflict, the temporary still present, the note unchanged.
- **L9 scope.** Only a write that stages a temporary at the note's name completes a leftover. A delete stages nothing there, so it neither needs nor runs that step. A delete planned on the bytes a failed rename left behind therefore succeeds. The committed bytes stay in the temporary and are reported as a conflict at the next open. The alternative, completing the leftover for deletes too, refuses that delete as stale. Which behaviour is wanted is a decision for the owner.
- **L7 reach.** A note inside a deeper folder named `.unifia` can no longer be updated or moved through the writer. Creates there were already refused, and the synchronous walk already skipped that name at every level.
- **Not in this list, not changed.** A delete committed to the WAL whose unlink did not run leaves the note visible after an open, with its previous bytes, while its trash copy exists. Recovery does not finish a committed delete. Found while writing the R2 crash case.

Residual, not closed here:

- **L10.** The window between the re-read and the unlink is narrower, not gone. Closing it needs a different primitive, such as renaming the judged lock away before the judgement. The window itself is exercised deterministically; a two-process reproduction of the race is not built.
- **L9.** The failed rename itself is not reproduced in-process: Linux gives no injectable fault here. The state it leaves is reproduced, and it is the state recovery completes.
- **L3, L5, L8** are not on this branch's list and are unchanged. A FIFO named `*.md` still fails the listing. A `null` line in the control log still breaks the tally. Audit rotation still replaces the earlier generation.
- **L1** is closed for writes made through this writer. The lock is host-local, and an edit made by a user between the check and the rename is not covered.
- **Windows.** The FIFO test, the symlink tests and the two-process test are skipped on Windows. Nothing here was run on Windows.

Verification: `bun test test/knowledge test/server test/auth` ran 1374 tests, 1370 passed, 0 failed (the baseline on 43a46b550 is 1353 ran, 1349 passed, 0 failed; 21 tests are new, all in `containment-review-regressions.test.ts`). On 43a46b550 that file gives 20 failures and one pass by design: the R1 guard, a crash before the rename that completes an update whose destination still holds the previous bytes. The existing expectation changed is the one named above; no other existing test was edited. The owner's own repros on the final code: R1 preserves the edit, R2 and R3 do not resurrect, R4 keeps the recreated source, R11 keeps the in-flight temporary, R12 and R14 are refused as described above, and the FIFO repro returns with a refusal. R7, R9 and R10 are L3, L8 and L5, which are not on this list and still fail. `bun run typecheck` exits 0. Biome reports no findings on the changed files.
