<!-- SPDX-License-Identifier: MIT -->
# BRANCH-POLICY — required checks on `dev` and `main`

Measured 2026-10-05 against `Rwanbt/unifia` at `dev` = `a71cd08d27`. **Document only — nothing in this file
changes protection.** Branch protection is owner-only (`DECISIONS.md`, "Actions réservées au propriétaire").

## How to re-measure this

```bash
gh api repos/Rwanbt/unifia/branches/dev/protection
gh api repos/Rwanbt/unifia/branches/main/protection
```

Both are `200` and return the same `required_status_checks.contexts`. A `404` means the branch is not
protected at all — that is a different, louder failure than a missing check, and it is worth distinguishing
when auditing.

Default branch: `gh api repos/Rwanbt/unifia --jq '.default_branch'` → **`main`** (owner-confirmed in D8; note
`AGENTS.md` contradicts this — card DOC01).

## The seven required checks

Identical on `dev` and `main`. All seven are GitHub Actions checks (`app_id` 15368):

| # | Check | What it is | Where it is defined |
|---|---|---|---|
| 1 | `check-compliance` | contributing-guidelines + PR-body compliance | `.github/workflows/` |
| 2 | `check-standards` | repository standards gate | `.github/workflows/` |
| 3 | `conformance` | conformance suite | `.github/workflows/` |
| 4 | `rust unit tests` | `cargo test` workspace | `.github/workflows/` |
| 5 | `sdk in sync with server` | generated SDK matches the server routes | `.github/workflows/` |
| 6 | `unit (linux)` | Bun unit suite on Linux | `.github/workflows/test.yml` |
| 7 | `unit (windows)` | Bun unit suite on Windows | `.github/workflows/test.yml` |

`strict` is `false` on both branches: a PR is judged on the checks of its **head** commit only, not on whether
the base moved. A green PR can therefore go red on merge without the PR ever having been re-run — squash-merge
promptly after a green head, or require a re-run, rather than assuming the merge result is already proven.

## Rest of the protection, both branches

| Setting | `dev` | `main` |
|---|---|---|
| `required_status_checks.strict` | `false` | `false` |
| `required_approving_review_count` | **absent — no reviews required** | `1` |
| `dismiss_stale_reviews` | absent | `true` |
| `require_code_owner_reviews` | absent | `false` |
| `required_linear_history` | `true` | `true` |
| `allow_force_pushes` | `false` | `false` |
| `allow_deletions` | `false` | `false` |
| `required_conversation_resolution` | `true` | `true` |
| `enforce_admins` | **`false`** | **`false`** |
| `required_signatures` | `false` | `false` |

`required_linear_history: true` is why every PR here merges by **squash**: a merge commit is rejected on both
branches.

## What is missing, and what that means

### 1. No review requirement on `dev`

`dev` has no `required_pull_request_reviews` at all. Every lane's PR merges into `dev` with **zero** human
review — which is the deliberate design for the automated train (D11: agents merge their own PRs once the
required checks are green), so this is a fact to record rather than a defect to fix. The cost is that the
required checks are the *only* gate on `dev`: a change that passes all seven and is wrong still lands.

### 2. `enforce_admins: false` on both branches

Protection does not apply to admins. Everything above is therefore a convention for anyone who opts in, not an
enforced boundary — including for the owner and for any token acting as an admin. This is the single largest
gap between "the policy says" and "the policy holds".

### 3. `required_signatures: false`

Commits are not required to be signed or verified.

### 4. Not required, though they run

These all run on PRs and are green on most PRs, but **none is required**, so a red one does not block a merge:

`typecheck`, `check`, `check-standards`'s siblings — concretely from `gh pr checks` on a live PR: `Analyze
(javascript-typescript)`, `CodeQL`, `check`, `typecheck`, `e2e (linux)`, `merge-and-size`, `nix-eval`,
`schema-and-snapshot`, `snapshot-freshness`, `license-upstream`, `rust unit tests` when it is not the Rust path.

Two of those deserve a decision rather than a shrug:

- **`e2e (linux)`** is not required. The QA03 e2e suite therefore cannot block a merge even once its failures
  are classified — which is what card A3's classification is for. It timed out on a 1 h 51 m job rather than
  failing (see `EXECUTION-LOG.md`, 2026-10-04 16:20), so today it is neither a gate nor a signal.
- **`CodeQL` / `Analyze`** are not required. The lane rules treat them as merge conditions anyway, so the
  written policy is currently stricter than the server policy.

### 5. `check-duplicates` is *not* required, but it is stuck pending anyway

Card A1 / issue #59. The check is not in the required list on either branch, so it does not block merging —
but every `pr-management` run on this fork never completes because `check-duplicates` queues against
`blacksmith-4vcpu-ubuntu-2404`, a runner label this fork does not have. Measured: `runner_id=0`, `steps=0`,
`completed` empty, across 12 consecutive runs. The job-level `if:` guard added in `684248b1bf` does not
prevent it. If `check-duplicates` is ever added to the required list **as-is**, every PR becomes unmergeable.

Patch and full diagnosis: `docs/autonomy/rc0/journal-A.md`, card A1.

## Practical consequences for an agent

1. Merge by **squash** — `required_linear_history` rejects anything else, on both branches.
2. The gate on `dev` is those seven checks and nothing else. Judge your own PR accordingly; there is no
   reviewer.
3. `strict: false` means the seven must be green **on the exact head** you intend to merge. A green run on an
   earlier commit is not evidence about the merge commit.
4. Never push to `main`. `main` additionally requires one approving review, so an agent cannot merge there
   even if it wanted to — but `enforce_admins: false` means that is a convention, not an enforced wall.
5. Expect `check-duplicates` to sit `pending` forever. Ignore it; it is not required and not fixable from a PR.
6. Runner starvation is real and separate: with several agents pushing at once, many workflows sit `queued`
   for a long time. `queued` on `ubuntu-latest` jobs is not a failure of your change.

## Changing this

Owner-only. To add a required check:

```bash
gh api -X PATCH repos/Rwanbt/unifia/branches/dev/protection \
  -f 'required_status_checks[strict]=false' \
  -f 'required_status_checks[contexts][]=check-compliance' \
  -f 'required_status_checks[contexts][]=<new-context>'
```

A `PATCH` that omits `required_pull_request_reviews` does not remove it, but a `PATCH` that sends
`required_pull_request_reviews=null` does — `main` has reviews configured and `dev` does not, so patch `main`
carefully or use the branch-protection UI.