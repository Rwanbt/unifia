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
- The source of a committed move is unlinked by the writer under the write lock. A reclaim of a dead writer's lock finishes that unlink only for the move the lock names: the sequence number the move recorded in the lock before its entry was appended (second review, item D). A lock that names no move finishes none. Before, every reclaim finished every move's source, so identical bytes written back at an old path were removed silently.
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
| R4, L6 | 33e0f4039 | On the second open, the source the user recreated byte-identical is removed. A live holder's in-flight temporary is discarded, or completed. | The open takes the write lock for recovery, and a live holder keeps the lock with recovery left to it. The move-source pass finishes only the move that a reclaimed lock names (second review, item D). The R4 test covers the lock this open reclaims, a dead lock that names the move; it does not cover a lock that names no move. Releasing the lock removes the crash marker, so it is consumed once, and a recovery that throws leaves the marker in place (second review, item E). |
| L4 | 0dc508368 | A `null` line throws a TypeError from the constructor. A move whose `previousLocator` is not a string throws in the move-source pass. | A line that is not an object is set aside and counted as malformed. The move-source pass passes over a `previousLocator` that is not a string. |
| L7 | 2ee998ca2 | An update through an in-vault alias to the trash rewrites the trashed note. A supersede naming it as successor does too. | `locate` judges a note by its real place and refuses the vault's own folder, as `resolveWritable` does. The synchronous walk passes over that folder by its real place. The second review (item C) extends this to the listing and to `resolveWritable`, which judge the real place too. |
| L10 | 0c4785489 | A lock written by a live writer between the judgement and the unlink is removed, and the acquire succeeds. | The reclaim re-reads the lock through the no-follow reader and removes it only when its text is unchanged. `WriteLock` takes an `afterJudgement` hook, which the test uses to make the window deterministic. |
| L1 | 506fdd7f1 | A stale update is committed on top of a version another writer has replaced. The two-process run has duplicate previous hashes. | `commit` and `remove` re-check, under the lock and before the WAL line or the trash copy, the state the write was planned against. A mismatch is refused with the same `cas_mismatch`. The owner's two-process repro reports 0 previous hashes with two commits; it reported 1. |
| L9 | 4ccddd1ea | Later writes to the note are refused with "a file is already present" instead of the stale-version refusal. | A write completes a leftover temporary at its name under the lock, through the recovery an open runs, before it checks its own expected state. |
| L4, second reader | c4cdc3233 | Found by grepping the L4 pattern. A trash sidecar of `null`, a number or an array throws a TypeError out of `restoreDeleted`; a sidecar that is not JSON throws a SyntaxError. | The sidecar's locator is read only from an object with a string locator. Anything else is refused as nothing in the trash, the refusal a missing sidecar gets. |

Decisions for the owner:

- **Changed expectation** in `third-review-regressions.test.ts`, "a delete after a committed write does not discard the write's temporary". It asserted completion of the temporary over the note. That is R2 (a later delete undone by a failed write's bytes), and it also overwrote a destination holding other bytes (R1). The title's property holds: the temporary is kept, not discarded. Completion cannot hold under R2 on any state the writer records, and the fixture's update carries a null previous hash, which the writer never records for an update. The test now asserts: not completed, reported as a conflict, the temporary still present, and the committed bytes not in the note. The second review (G) removed the visible-bytes check from this test, and replaced the fixture's null previous hash (00a3c0481). See the second review's R2 entry for the property each test checks now.
- **L9 scope.** Only a write that stages a temporary at the note's name completes a leftover. A delete stages nothing there, so it neither needs nor runs that step. At 43a46b550 a delete planned on the bytes a failed rename left behind succeeded, and the committed bytes stayed in the temporary as a conflict. The alternative, completing the leftover for deletes too, refuses that delete as stale. The second review (item A) took the alternative: a delete planned on those bytes is refused as stale.
- **L7 reach.** A note inside a deeper folder named `.unifia` can no longer be updated or moved through the writer. Creates there were already refused, and the synchronous walk already skipped that name at every level.
- **Not in this list, not changed.** A delete committed to the WAL whose unlink did not run leaves the note visible after an open, with its previous bytes, while its trash copy exists. Recovery does not finish a committed delete. Found while writing the R2 crash case. Still so at 83e238d5a: the crash matrix (second review) reproduces it, and its test asserts that the note keeps its previous bytes. If the owner decides that recovery should finish a committed delete, that test changes with the decision.

Residual, not closed here:

- **L10.** The window between the re-read and the unlink is narrower, not gone. Closing it needs a different primitive, such as renaming the judged lock away before the judgement. The window itself is exercised deterministically; a two-process reproduction of the race is not built.
- **L9.** The failed rename itself is not reproduced in-process: Linux gives no injectable fault here. The state it leaves is reproduced, and it is the state recovery completes.
- **L3 and L5** are fixed on this head: a FIFO named `*.md` is skipped by the listing, and a non-object line in the control log is set aside by the tally. Both were re-run at 83e238d5a with the review's repros, and both pass. **L8** (audit rotation) still replaces the earlier generation; whether one generation is the intended design is the owner's decision.
- **L1** is closed for writes made through this writer. The lock is host-local, and an edit made by a user between the check and the rename is not covered.
- **Windows.** The FIFO test, the symlink tests and the two-process test are skipped on Windows. Nothing here was run on Windows.

Verification: `bun test test/knowledge test/server test/auth` ran 1374 tests, 1370 passed, 0 failed (the baseline on 43a46b550 is 1353 ran, 1349 passed, 0 failed; 21 tests are new, all in `containment-review-regressions.test.ts`). On 43a46b550 that file gives 20 failures and one pass by design: the R1 guard, a crash before the rename that completes an update whose destination still holds the previous bytes. The existing expectation changed is the one named above; no other existing test was edited. The owner's own repros on the final code: R1 preserves the edit, R2 and R3 do not resurrect, R4 keeps the recreated source, R11 keeps the in-flight temporary, R12 and R14 are refused as described above, and the FIFO repro returns with a refusal. R7 and R10 (L3 and L5) pass on this head. R9 (L8, rotation) still fails, and it is the owner's decision. `bun run typecheck` exits 0. Biome reports no findings on the changed files.

## Second review of 43a46b550 (2026-10-12): confirmed defects, and their resolution

An independent review of PR #489 found the items below. Each was reproduced on bd86f927e before any change, and each has a regression that failed there. One commit per item, in the order below. The "observed" column is what the regression or repro showed before the fix, on the base the row names. Items J, K and M were added at the end of the review; their rows name the bases they were checked on.

| Item | Severity | Defect | Commit | Observed before the fix (base named in the row) | Fix |
|---|---|---|---|---|---|
| A | high | A delete or move planned on superseded bytes trashes or moves those bytes, and the committed write is left as a conflict. | ef6b064eb | the stale delete and the stale move were applied; the trash held the superseded bytes | `remove`, the source side of a move, `supersede` (both notes) and the destination of a restore complete the leftover temporary under the lock before their check, as `commit` does. A stale plan is refused. |
| B | high | A recovery conflict blocks one name, and nothing shows it. | bdf89610d | the refusal said only "already present"; no read-only listing existed | A write at a name with a held temporary is refused with the note's locator and "did not complete". The judgement recovery makes is shared with a read-only scan, `pendingWriteConflicts`, which the doctor lists as `pending_conflict`. The CLI `unifia knowledge doctor [workspace]` takes the workspace and does not open the vault. Resolving a conflict is not implemented: the owner decides whether it is wanted. |
| C | medium | A directory alias of another name that points at `.unifia` is listed, and a create through it lands in the trash. | 31ec2b3ea | the listing held the trashed note; the create was applied into `.unifia/trash` | The walk judges the real place of each directory and file, and `resolveWritable` judges the real place a write would land at. `isInternalLocator` moves to the containment module, where both judge. |
| D | medium | A later reclaim of an unrelated dead lock unlinks the source of a completed move that the user restored byte-identical. | a505e01aa | the restored source was removed by an unrelated open | Option (ii): the lock records the sequence number of a move or restore before its entry is appended (`{pid, at, seq}`). A reclaim returns that number, and the pass finishes only the entry with it. |
| E | low | A failed open released the lock, so the next open did not know a crash had happened. | 47da3094a | after a failed open the lock was gone | A recovery that throws calls `WriteLock.abandon()`: a reclaimed lock is written back as the dead holder left it, and a lock this attempt created is removed. |
| F | low | `supersede` wrote the successor before a refusal of the target. | a41d5a8a0 | the successor listed the target after a refused supersede | The target's conflict and hash checks run before the successor's first write. |
| G | low | A fixture recorded a null previous hash for an update, which the writer never records. | 00a3c0481 | coverage: the test passed before and after | The fixture records the hash of the bytes the update replaced, and its delete records the bytes it removed (83e238d5a). The visible-bytes assertion is dropped: whether a committed delete leaves the note visible is open (the residual above). |
| I | plausible | A purge between a restore's read of the trash and its commit is undone by the restore. | 61b9f7deb | reproduced with the `afterRestoreRead` hook: the purge applied and the note was restored after it | The read and the commit run under one lock, through `restoreLocked`. A purge waits for it or is refused. The hook is a test seam, absent in production. |
| J | pre-existing | `WriteLock.release` removes the lock without checking that it still holds this holder's identity, so a wrongful reclaim's replacement is removed by the first holder's release. | 12af70f82 | on bd86f927e: the replacement lock was removed by `release` (ENOENT on re-read). `recordInFlight` did not exist there yet (item D added it). On 61b9f7deb it overwrote a replaced lock without throwing. | `release`, `abandon` and `recordInFlight` act only on the lock file that still carries this holder's pid and timestamp. `recordInFlight` refuses a replaced lock with the contention message, and keeps "the write lock is not held" for a call made outside the lock. The check and the unlink are two calls, so the window between them is H. |
| K | minor | An object WAL line with no sequence number makes the next sequence NaN, which is written as `null`. | 8510b814e | on bd86f927e: the WAL read back `[1, undefined, null]`, not `[1, 2]` | Such a line is malformed, as a line that is not an object is. |
| M | medium | A sidecar whose trashed copy is gone is listed as a trash entry, and `emptyTrash` writes an erasure line to the WAL for a note that is still in the vault or was restored. Found by the crash matrix. | e0f3db218 | on 8510b814e: a sidecar with no copy was listed. A purge destroyed it and wrote "permanent erasure of n.md" while the note stayed in the vault (probe). Four matrix states failed. | `trash()` lists an entry only while its trashed copy is a regular file of its own. A trashed copy with no WAL line is not covered: see the residuals. |
| H | plausible | The window between the re-read of a dead lock and its unlink (L10). | none | not reproduced without a hook; see the residual below | Not changed. See below. |

Decisions taken, and the options not taken:

- **D, option (ii).** Option (i), a completion line per move, was not taken. A completion line covers only moves written after the change, so every move already in a vault's WAL stays exposed to the same unlink. It also needs a new `WalKind`, and that union is closed. Option (ii) adds one optional field to the lock file, which an older reader ignores.
- **B, no resolve command.** The owner decides whether one is wanted.
- **Visible-scope doctor.** `GET /knowledge/doctor` does not list pending conflicts. Listing one would name a note the principal may not read. Whether the route lists the conflicts of visible notes is the owner's decision.
- **M, listing by the copy only.** A listing that also required a WAL delete line was not taken. It would hide any trashed copy the WAL does not name, and whether older vaults always logged their deletes was not checked.

Changed expectations and fixtures, each with its reason (no test was deleted, and no assertion that pinned a defect was kept):

- `containment-review-regressions.test.ts`, R2 and R3 (`a delete after the pending write`, `a move after the pending write`): these planned the delete and the move on the superseded bytes. They are now refused as stale (item A), so the R2 and R3 assertions change to the refusal, and the R3 title changes to match. Each has a new case planned on the committed bytes, which is the applied path.
- `containment-review-regressions.test.ts`, R4 and the mid-move and mid-restore fixtures of `writer-atomicity.test.ts` and the "finishes the unlink" test of `third-review-regressions.test.ts`: a dead lock that stands for a move in flight now names the move's sequence number, as a writer that died there leaves it. The expectations are unchanged. A seq-less lock now names no move, so its source is kept.
- The direct `recover()` calls of the mid-move and mid-restore fixtures pass the sequence number the reclaim would return. The `afterCrash` option is replaced by `inFlightSeq`; the one test that passed `afterCrash: false` passes `{}`.
- `third-review-regressions.test.ts`, G: see the table.
- `third-review-regressions.test.ts`, R2 ("a delete after a committed write does not discard the write's temporary"). The original (ade0032c3) asserted that recovery completes the temporary over the note after a later delete, so the note ends with the committed bytes. That expectation is the R2 defect. The title names the property the test was written for: the write's temporary is not discarded. That property is checked now by the temporary still being present and one conflict being reported. The R2 property, that a later delete is not undone by the pending bytes, is checked by nothing being completed, and from 83e238d5a by the note not holding the committed bytes. Two other tests check the same property on other fixtures: `containment-review-regressions.test.ts`, "a delete committed to the WAL whose unlink did not run is not undone by the next open" (the temporary keeps the pending bytes, nothing is completed, the note keeps its previous bytes); and "a delete after the pending write is not undone by the next open" (the live delete is refused, and the note keeps the committed bytes). The fixtures record a previous hash on the update (00a3c0481) and on the delete (83e238d5a), which the writer records for both. A mutation that makes recovery ignore a later delete fails the R2 case and the WAL-delete case; the live-path case does not depend on recovery, because the delete is refused first.
- `crash-matrix.test.ts` is new. Two existing tests name a state their fixture does not reproduce, and are not changed. `delete.test.ts`, "survives a crash between the trash copy and the unlink", runs a complete delete, so it checks the state after the unlink. `writer-atomicity.test.ts`, "recovery reopens the vault with no orphan source after a real crash" and "a real mid-restore crash leaves no duplicate after reopen", write the post-crash files by hand, and no process is killed. The matrix below names the test that reproduces each state.

**Crash matrix.** The points are the steps of `commit` (temporary, WAL line, rename, unlink of the source), of `remove` (sidecar, trash copy, WAL line, unlink of the note) and of `restoreLocked` (read of the trash, temporary, WAL line, rename, removal of the trash copy, removal of the sidecar). "The lock names" the move or restore means the lock holds the number recorded before its WAL line was appended. Each test reopens the vault and checks the outcome; none kills a process, and the states are the files a crash leaves. Before e0f3db218, four rows listed a sidecar with no copy as a trash entry: the restore rows after the WAL line, after the rename and after the copy is removed, and the delete row after the sidecar.

| Operation | Crash point | State left | Next open does | Test |
|---|---|---|---|---|
| create | before the temporary | nothing | nothing | durability.test.ts: "crash before the temporary: nothing to do" |
| create | after the temporary, before the WAL line | temporary | discards it; note absent | durability.test.ts: "crash after the temporary, before the WAL: the write is discarded" |
| create | after the WAL line, before the rename | temporary, WAL line | completes the rename | durability.test.ts: "crash after the WAL, before the rename: the write is completed" |
| create | after the rename | note, WAL line, no temporary | nothing | crash-matrix.test.ts: "a crash after the rename, with no temporary left, changes nothing on reopen" |
| update | after the temporary, before the WAL line | old note, temporary | discards it; the old bytes stay | crash-matrix.test.ts: "a crash after the temporary, before the WAL line, keeps the old bytes and discards the temporary" |
| update | after the WAL line, before the rename | old note, temporary, WAL line with the old hash | completes the rename | containment-review-regressions.test.ts: "a crash before the rename completes an update whose destination still holds the previous bytes" |
| update | after the WAL line, a user edit before the open | edited note, temporary, WAL line | keeps the edit, the temporary and the WAL; reports a conflict | containment-review-regressions.test.ts: "a user edit made after the crash survives the open and the next open, and the pending write is kept as a conflict" |
| update | after the rename | new note, WAL line, no temporary | nothing | crash-matrix.test.ts: "a crash after the rename, with no temporary left, keeps the new bytes" |
| move | after the temporary at the destination, before the WAL line | source, temporary at the destination; the lock names a number with no entry | discards the temporary; keeps the source | crash-matrix.test.ts: "a crash after the temporary, before the WAL line, keeps the source and discards the temporary" |
| move | after the WAL line, before the rename | source, temporary, WAL line; the lock names the move | completes the rename; unlinks the source the lock names | crash-matrix.test.ts: "a crash after the WAL line, before the rename, completes the move and removes the source" |
| move | after the rename, before the source unlink | both copies, WAL line; the lock names the move | unlinks the source, once | containment-review-regressions.test.ts: "the open after the crash removes the leftover source once; a later open keeps the same bytes written back at that path" |
| move | after the source unlink | destination only | nothing; a later open keeps identical bytes written back at the old path | third-review-regressions.test.ts: "recovery without a crash keeps identical bytes written back at the old path" |
| restore | after the trash read, before the temporary (aborted) | trash entry, note absent | nothing; a later restore applies | crash-matrix.test.ts: "an aborted restore, after its read and before its temporary, leaves the entry trashed, and a later restore applies" |
| restore | after the temporary, before the WAL line | trash copy and sidecar, temporary at the destination | discards the temporary; the entry stays trashed | crash-matrix.test.ts: "a crash after the temporary, before the WAL line, leaves the entry trashed and discards the temporary" |
| restore | after the WAL line, before the rename | trash copy and sidecar, temporary, WAL line; the lock names the restore | completes the rename; removes the trash copy; the sidecar is left and not listed | crash-matrix.test.ts: "a crash after the WAL line, before the rename, restores the note and lists nothing as trashed" |
| restore | after the rename, before the trash copy is removed | note, trash copy and sidecar, WAL line; the lock names the restore | removes the trash copy; the sidecar is left and not listed | crash-matrix.test.ts: "a crash after the rename, before the trash copy is removed, lists nothing as trashed"; writer-atomicity.test.ts: "recovery drops the trashed copy that survived a mid-restore crash" |
| restore | after the trash copy is removed, before the sidecar | note, sidecar, WAL line; the lock names the restore | nothing; the sidecar is not listed; a purge destroys nothing | crash-matrix.test.ts: "a crash after the trash copy is removed, before the sidecar, lists nothing and purges nothing" |
| delete | after the sidecar, before the trash copy | note, sidecar | nothing; no entry is listed | crash-matrix.test.ts: "a crash after the sidecar, before the trash copy, leaves the note in the vault and no trash entry" |
| delete | after the trash copy, before the WAL line | note, trash copy, sidecar, no WAL line | nothing recovered; note and copy kept; a restore over the note is refused. The copy is still listed (open, see the residuals) | crash-matrix.test.ts: "a crash after the trash copy, before the WAL line, keeps the note and the copy, and refuses a restore over the note" |
| delete | after the WAL line, before the unlink | note, trash copy, sidecar, WAL line | nothing recovered; the copy holds the note's bytes; whether the note stays visible is open | crash-matrix.test.ts: "a crash after the WAL line, before the unlink, keeps the trash copy holding the note's bytes"; containment-review-regressions.test.ts: "a delete committed to the WAL whose unlink did not run is not undone by the next open" |
| delete | after the unlink | trash copy, sidecar, WAL line, no note | the entry is listed; a restore brings the note back | crash-matrix.test.ts: "after the unlink, a reopen lists the entry, and a restore brings the note back" |
| delete, after a pending write (live, refused) | a delete planned on the superseded bytes | note with the old bytes, temporary, WAL update | the write completes under the lock; the delete is refused; nothing is recovered afterwards | containment-review-regressions.test.ts: "a delete after the pending write is not undone by the next open" |

Two notes on the table. durability.test.ts "crash after the rename: recovery is idempotent" leaves a temporary beside the landed note, which a rename never leaves, so the "after the rename" row is covered by the crash-matrix test instead. delete.test.ts "survives a crash between the trash copy and the unlink" runs a complete delete, so it checks the state after the unlink, the last delete row.

Residuals and owner decisions:

- **H (L10), assessed and not implemented.** A second exclusive lock around the re-read and the unlink needs its own rule for a reclaim lock left by a crashed reclaimer, and that rule is the same problem one level down. Options: (a) a reclaim lock with a time-only fallback, which narrows the window to the reclaim's length but does not close it; (b) rename the judged lock to a unique name, check its content, and delete it, restoring it with `link` (which does not overwrite) if it is not the judged lock, which leaves a short window where a second writer runs with the lock displaced; (c) keep the window, and rely on the identity check of J at release. Choosing among them is the owner's decision.
- **Legacy locks.** A lock written by an earlier build names no move. A move in flight at the moment of an earlier build's crash keeps its duplicate source after the upgrade. Nothing is deleted on a guess, and this happens once.
- **A restore between a crash and the next open.** The lock names the move, not the bytes, so a source the user restores byte-identical between the crash and the next open is removed by that open. This is the in-flight move's own leftover.
- **A failed open restores a time-only lock with a new mtime.** The next open within `LOCK_STALE_MS` finds it held and skips recovery silently, as it does for a live holder.
- **emptyTrash lists entries outside the lock.** A restore that takes an entry between the listing and the purge leaves a purge line for a note that was restored. No content is lost, but the WAL says erasure. Not changed.
- **A delete of a note with a held conflict is still applied** (the L9 scope, as recorded above).
- **L8, audit rotation** still replaces the earlier generation (R9 fails). Owner decision.
- **A trashed copy with no WAL line** (delete, after the copy and before the WAL line) is still listed by `trash()`. A purge of it writes an erasure line for a note that is still in the vault, and removes the copy. Observed with a probe on 8510b814e; e0f3db218 lists it by the same rule, since the copy is present. Excluding it needs the WAL in the listing, and the decision in M above. Recovery does not remove the copy either: nothing in the WAL names it as a trash entry, and removing a copy is the owner's decision.
- **Orphan sidecars.** A restore finished by recovery does not remove its sidecar. The sidecar is no longer listed, but it stays in `.unifia/trash` until someone removes it.
- **The owner's R4 repro** writes a dead lock with no sequence number. Its first open keeps `a.md`, because the lock names no move (item D). The second open keeps the recreated file. The crash form, a lock that names the move, is removed on its first open: `containment-review-regressions.test.ts`, "the open after the crash removes the leftover source once".
- **The mobile bundle.** `packages/mobile/src-tauri/assets/runtime/unifia-cli.js` is tracked. It is generated by `scripts/bundle-mobile.mjs`, it predates this branch (it has none of its changes), and it was not regenerated here. It needs a rebuild before an Android build, and that rebuild is not part of this review.

Windows: nothing in this section was run on Windows, and no Windows result is claimed. Checked at 83e238d5a: Bun's line coverage does not separate a branch's condition from its body, so each claim below was checked with a logging probe in a scratch copy (the worktree is unchanged).

- Covered on POSIX by a test, skipped on Windows: the lock at a named-pipe path (`containment-review-regressions.test.ts`, L2), which reaches the non-regular-file branches of `reclaimIfStale` and `readNoFollow`; the listing's FIFO skip (`source/vault.test.ts`, "a named pipe named like a note does not stop the listing"); the L7 alias tests, which reach the alias refusal in `locate` and the directory-alias skip in `locateSyncInner`; and the two-process CAS test.
- Covered by no test on any platform: the file-alias skip in `locateSyncInner` (no test puts a file alias on the synchronous path); and the `isRegularFileSync` guard in `readContainedByHandle` and `readContainedByHandleSync`. A direct read of a named pipe reaches the async guard, but no test does that.
- Reached on Windows only, and covered by no Windows test: the `isLinkNow` branch of `writeNewFileDurable`, `appendLineDurable` and `readNoFollow`. On systems with `O_NOFOLLOW` (Linux, macOS) `isLinkNow` returns false, so that branch is never taken there.
- Covered by no test on any platform: the retry on transient codes in `renameDurable` (EPERM, EACCES, EBUSY). The suites took no transient error on Linux, and no test injects one.

Verification at 83e238d5a. `bun test test/knowledge test/server test/auth --timeout 30000` ran 1407 tests: 1403 pass, 0 fail, 4 skip. The last complete run before this review's J and K (after item I, at 61b9f7deb) was 1386 pass, 0 fail, 4 skip. The 17 new passes are J (2), K (1) and the crash matrix (14). `tsgo --noEmit -p packages/unifia` exits 0 on a clean `git archive` of HEAD, and writes no build info. Biome: the repo's configured command, `bunx biome check`, covers `packages/unifia/src/**` only, and exits 0 on the two changed source files. The changed test files are outside that scope. Biome with the same rules reports one warning on them: an unused constant `OPEN` in `third-review-regressions.test.ts`. The warning predates this review and is left as it is.

The owner's repros, against the working tree at 83e238d5a. R1 preserves the edit. R2 and R3: the stale delete and the stale move are refused; the committed bytes stand, and nothing is trashed, moved or resurrected (probe). R4, as written: the first open keeps `a.md`, because the lock names no move (see the residuals), and the second open keeps the recreated file. R5: one write applies and the other is refused; the repro's label "both reported applied" is out of date. R7 lists. R8 opens all four forms. R9 fails, the owner's decision. R10 tallies without throwing. R11 keeps the temporary. R12 is refused as a stale version. R14 is refused, and the trash file is byte-identical afterwards (probe). The FIFO repro gets the typed busy refusal, which its script does not catch, so it exits 1. The CAS repro reports 0 previous hashes with two commits.

### Egress control log: bounded generations (fix/audit-log-generations, 2026-10-12)

This section closes the audit-rotation item in the residual list above (L3, L5, L8). The null-line item there is covered by the existing test "tally counts the valid decisions around a null line", which passes.

**Step 0 mini-ADR.** *Context:* the control log kept one previous generation, which a second rotation overwrote; readers opened only the active file; a failed rename was swallowed while the log grew past its limit. *Decision:* the trail is six chained generations of at most 8 MiB, rotated through a temporary file and atomic renames, read as one chain, and checked by a read-only verifier.

| Limit | Value |
|---|---|
| Decision line, from the guard's reason strings | 316 bytes average, 435 bytes worst |
| `ROTATE_AT_BYTES` | 8 MiB; a generation is sealed before the next batch, so at most 8.4 MB |
| `CONTROL_LOG_GENERATIONS` | 6: the active generation and five archives |
| Disk bound | 6 × 8.4 MB ≈ 50 MB (48 MiB) per workspace |
| Decisions per generation | about 26,600 (19,300 at the worst line) |
| Readable once rotated | five sealed generations, about 133,000 decisions (96,000 at worst) |

Retention is by count and size, not by age. At an assumed 1,000 decisions a day the guaranteed window is about four months; the repository does not measure real traffic.

- **Format.** A generation starts with a header line (`index`, `firstSeq`, `continues`). Each entry carries `seq` and `prev`, the SHA-256 of the entry line before it. A reader that parses every line as an entry must skip the header line.
- **Rotation**, in the order it reaches the disk: write the next active generation (header only) to `control-log.jsonl.rotating` and fsync it; rename the active file to `control-log.jsonl.<k>`; rename the temporary to `control-log.jsonl`; remove the oldest archive while more than N exist. Each rename is followed by a folder fsync. Removal runs only once the new set is in place, and before the batch is appended. A rename never overwrites: a target that exists is refused.
- **Recovery** runs on the first write after an open, under the write lock. It removes a temporary that sits beside an active file, and commits one that has no active file. Construction does no I/O, and a read never repairs: while the active file is missing, a reader takes the temporary as the active generation. The owner's "recovery on the next open" is implemented as recovery on the first write. Tests inject a crash after each of the four steps.
- **Failures.** A failed write or rotation is sticky, as before: the sink refuses to record. The record that triggers a failing flush is withdrawn, so it reaches neither the batch nor the bus, and its caller gets the error. A lock held by another live writer is transient: the decisions stay pending and the sink is not broken. Two writers on one trail keep one chain, because each write takes the lock and reads the head again.
- **Cost, open.** Each flush takes the write lock, which creates and fsyncs a lock file. On the development machine a flush went from 1.5 ms to 6.0 ms (one entry) and from 1.8 ms to 7.9 ms (64 entries). Removing that fsync changes `WriteLock`'s durability for vault writes too, which is the owner's decision; the lock stays until then.
- **Losses, stated.** Up to 63 decisions buffered since the last flush of a process, and a batch whose append had not reached the disk when the process was killed or the power failed. A crash during a rotation loses no written entry.
- **Reads.** `entries()`, `tally()` and `destinationsFor()` read the newest six generations as one snapshot, in order. A gap, a hash mismatch, a missing middle generation or an unreadable header is a `source_inconsistent` error, which the route answers as an unavailable vault. A line that does not parse is skipped and reported as a notice.
- **Verifier and export** (`src/knowledge/admin/control-log-audit.ts`). `verifyControlLog` is read-only: sequence range, generation count, chain status (`empty`, `legacy`, `verified` or `broken`), size, head hash and the first finding. It cannot see an edit to the last entry of the newest generation, or the deletion of that generation, without the head hash recorded elsewhere, so an owner keeps the head. `exportControlLog` copies every generation byte for byte, outside the trail, with a manifest of hashes; `verifyControlLogExport` checks the copy later, without the workspace. `GET /knowledge/audit/verify` returns the report and the number of pending decisions.
- **Restricted access.** Files this code creates are 0600 on POSIX, and an adopted legacy generation is tightened to 0600. On Windows modes are not kept and the files take the access of their folder. Not verified: no Windows run was made for this change.
- **Migration.** The single previous generation of the old format is generation 1, the oldest, kept as it is. The old current file is sealed as the next archive, and the new active generation continues from its last line. Both report `legacy: not verifiable before this format`. Nothing is deleted at migration; the legacy generations leave like any other oldest generation, when the retention needs the room.

## Nested `.unifia` folders (owner decision, fix/nested-internal-folders, 2026-10-12)

**Step 0 mini-ADR.** *Context:* the vault's own folder `.unifia` holds its WAL, locks, trash, conflicts and policy, but a folder of that name below the vault root (a copy from another machine, an old layout) was skipped by the listing while recovery, the explicit reads, the link checks and the conflict plans still reached it, and the listing dropped it silently. *Decision:* a nested `.unifia` folder is not an authority: nothing in it is read, listed, searched or written, nothing in it is changed, and the listing names it. One rule decides the name everywhere, and one rule decides the real place of a write.

### What counts as nested

The vault's own folder is `<root>/.unifia`. A folder of the name at any depth below the root is nested, in any spelling below. A `.unifia` above the vault root does not count: the default vault `project/.unifia/memory` is supported, because its `.unifia` is above its root, not below it.

| Spelling | Platform that produces it | Refused on |
|---|---|---|
| `.unifia` | all | all |
| `.UNIFIA`, `.Unifia` | macOS and Windows fold case; Linux does not | all |
| `.unifia.`, `.unifia ` | Windows drops trailing dots and spaces | all |
| `UNIFIA~1`, `UNIFIA~12` | Windows 8.3 short name | all |
| `.unifia:stream`, `.unifia::$INDEX_ALLOCATION` | NTFS: a stream of the folder, or the folder by its index | all |
| `.unıfıa` (dotless i) | NTFS upper-cases the dotless i to I | all (reasoning only) |

Not the folder: `unifia`, `.unifia-notes`, `Unifia Notes` (its 8.3 name is `UNIFIA~1`, but a walk reads long names), and the Windows device names `CON`, `NUL` and so on, which have their own rule. The one rule, `isInternalSegment` in `source/containment.ts`, refuses every spelling on every platform: one vault is cloned, opened and synced across platforms, so a name that is `.unifia` on one is `.unifia` on another. The cost is that a Linux folder spelled `UNIFIA~1` is refused too; its owner renames it.

### Supported and refused layouts

| Layout | Read | Listed | Searched | Written | Status |
|---|---|---|---|---|---|
| An ordinary folder below the root, including one named `memory`, `unifia` or `unifia-notes` | yes | yes | yes | yes | supported |
| A vault root under a `.unifia` folder above it (the default `.unifia/memory`) | yes | yes | yes | yes | supported |
| The vault's own folder, `<root>/.unifia` | no | no | no | no | bookkeeping, never a note |
| A nested `.unifia` folder, in any spelling above | no | no (named as skipped) | no | refused | reported, not an authority |
| A note reached through a file or folder link whose real place is one of the folders above | no | no | no | refused | refused |
| A write whose place is a dangling link into one of them | not applicable | not applicable | not applicable | refused, by locator | refused |

No nested layout is read and listed but never written. Under this decision a nested `.unifia` folder is neither read nor listed, and a folder that is read and listed is an ordinary folder, which is written like any other.

### Behaviour

- **Writes.** A create, a move, a restore, or a conflict plan or apply whose locator or real place is in such a folder is refused with `mutation_refused`, and the message names the locator and no absolute path. An update, a delete or a supersede names its note by id, and finds no note in such a folder, so it fails as a missing note; the folder is not read to find it.
- **Reads by locator** (`source.read`, `get`, `readOwned`, `versionHash`). The answer is absent, as for a note that is not there. Nothing is read from the folder, through a plain locator, another spelling of the name, a file link or a folder link.
- **Listing and search.** The notes of such a folder are not returned, and `lastScanErrors` does not name the folder: it is for notes that failed to parse.
- **Recovery and the conflict listing.** A temporary in such a folder is neither completed nor discarded, and is not a pending write. A temporary already there is kept.
- **Report.** `GET /knowledge/tree` names each nested folder in `unmanaged`, by its vault path, with the reason `nested vault folder`, beside the files that are not governed notes. The same list is `lastScan.nestedFolders` for a caller of the source. The shapes of the list, the search and `lastScanErrors` do not change.

### What an operator does

- The software moves, renames and deletes nothing in such a folder.
- To bring its notes into the vault, rename the folder to a name outside the table, for example `notes/.unifia` to `notes/unifia-archive`. Its notes then follow the ordinary rules. A note whose identity is already in the vault is reported as a duplicate identity by `unifia knowledge doctor`, and is resolved by hand.
- To keep the folder out of the vault, leave it. It is named on every tree listing, and nothing in it changes.
- Do not rename the vault's own folder at the root. It holds the WAL, the locks, the trash, the conflicts and the policy.

### Links

A link is judged by the real place it leads to, for a read and for a write. A dangling link is followed to its target, up to 32 links, because a write through it lands there. A link whose real place is the vault's own folder or a nested one is refused as a write target, and a read through it is absent.

### Consequences and residuals

- **No migration.** No file is moved, renamed or deleted. A temporary that a nested folder held before this change is kept where it is; before, recovery could have discarded it on open.
- **Behaviour changes.** An explicit read by locator of a note in such a folder returns absent. A folder that was skipped silently is now named. Recovery no longer completes or discards a temporary in such a folder. The existing test "a committed temporary in a folder named like the vault's own folder, deeper in the vault, is recovered" pinned the old behaviour; its assertions were reversed to this decision and are not weakened.
- **Not verified on Windows or macOS.** The rules for `.unifia:stream`, the dotless i, the trailing dots and the 8.3 names were reasoned from how those platforms name files, and the tests say so. Linux was the only platform run here.
- **Residual.** The check is by name and by real path when the walk reaches a folder, not by a handle. A folder renamed between that check and a later read is not caught; this is the same residual as the earlier reviews record for the directory check.
- The admin commands read notes by path, but only from locators the walk yields, and the walk yields none from such a folder.
