<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# RB05 — control truth table

Every visible control of Home, Chat, Code, Work, Design, Automate, Memory,
Settings and Account, classified **REAL**, **EXPLICITLY_DISABLED** or
**REMOVED**. Card RB05 of the RC-0 release-1 push (lane B).

`RC0-CONTROL-CENSUS.md` was the starting point and it says of itself that "No
candidate is automatically classified REAL". This document classifies them, on a
fixed SHA, with the classification rule stated so it can be re-run and
disagreed with.

## How this was measured

Base: `origin/dev` = **`56ad2a2ad45cb1d57f51eb38f8df36399cd43ee7`** (clean tree,
`sourceDirty: false`).

```sh
cd packages/app
bun run scripts/parity/control-census-run.ts > census.json
```

547 tracked TypeScript files parsed, **3077 structural candidates**, 6 869 944
bytes. The census is structural by design — "handlers and labels do not prove
behavior or visibility" — so every classification below is derived from the
candidate's own attributes, and the two classes that cannot be decided from
attributes alone were read in the source and are cited by `file:line`.

Classification rule, applied mechanically to all 3077 candidates. The classes are
**mutually exclusive**, so the columns sum to the census total and nothing is
counted twice:

| Class | Rule |
|---|---|
| **REAL** | an `on*` handler attribute is present and no disable marker at all |
| **EXPLICITLY_DISABLED** | `disabled` / `aria-disabled="true"` literal, or `data-soon`, or a `Soon` / `SoonAction` / `ComingSoon` wrapper — the RB07 shape |
| **CONDITIONALLY_DISABLED** | a disable marker driven by an expression (`disabled={expr}`): a REAL control that is unavailable in some state |
| **spread-only** | no handler, no disable marker, but props are spread in, so the behaviour cannot be decided from the element |
| **STATIC** | no handler, no disable marker, no spread: layout, labels, `Card`/`Row`/`Tooltip` wrappers. Not controls. |

Two counting traps were hit and corrected rather than papered over:

- `disabled={expr}` **with** a live handler is not a no-op. 47 such controls
  exist; each works whenever its expression is false. They are counted as REAL,
  because a control that is temporarily unavailable is still real.
- A first pass counted REAL as 983 by including those 47 and later excluding
  reactively-disabled ones, which double-counted 162 rows. The partition below
  is the corrected one.

## Per surface

| Surface | Candidates | REAL | EXPLICITLY_DISABLED | CONDITIONALLY_DISABLED | spread-only | STATIC |
|---|---|---|---|---|---|---|
| shared (app shell, dialogs, sidebar, primitives) | 1258 | 304 | 8 | 56 | 10 | 880 |
| Settings | 638 | 146 | 15 | 45 | 3 | 429 |
| Design | 283 | 91 | 6 | 23 | 1 | 162 |
| Chat | 229 | 71 | 0 | 26 | 1 | 131 |
| Code | 190 | 49 | 13 | 5 | 0 | 123 |
| Automate | 166 | 48 | 5 | 9 | 0 | 104 |
| Memory | 118 | 58 | 0 | 3 | 0 | 57 |
| Work | 117 | 39 | 2 | 4 | 0 | 72 |
| Account | 57 | 6 | 5 | 3 | 0 | 43 |
| Home | 21 | 9 | 0 | 0 | 0 | 12 |
| **total** | **3077** | **821** | **54** | **174** | **15** | **2013** |

No row is left unclassified, and each row's columns sum to that row's candidate
count.

One correction worth recording, because it is the same shape as the false
negatives the execution log has twice retracted: the first pass of this table
reported **Memory | 1 | 0 | 0**. That was the file mapping, not the product.
Memory's controls live in `pages/session/memory-panel.tsx` (92 candidates),
`memory-knowledge-graph.tsx` (15) and `memory-graph.tsx` (10), and a broad
`pages/session/` rule was claiming them for Chat — while Chat's own total was
inflated to 346 to hide it. Absence of a match is not absence of the control.

## Silent no-ops: none

A silent no-op is a control that renders as clickable, carries no handler, no
disabled marker and no spread. Restricting the search to genuinely interactive
native elements (`button`, `a`, `input`, `select`, `textarea`, `summary`) yields
**3 candidates**, and all three are refuted by reading them:

| Candidate | Why it is not a no-op |
|---|---|
| `pages/session/terminal-panel-chrome.tsx:39` `<button role="tab" aria-selected="true">` | the one permanently selected tab of a tablist; its siblings are the `ComingSoon` placeholders. Clicking the selected tab correctly does nothing. |
| `pages/workbench/design-browser-tab.tsx:107` `<button type="submit">` | submits its enclosing `<form>`; the behaviour is on the form, not the button. |
| `pages/workbench/design-toolbar.tsx:221` `<a download>` | rendered only inside `<Show when={props.snapshot.kind === "ready"}>`, so the `href="#"` arm is unreachable. Its own ternary on `kind === "ready"` is redundant, not broken. |

**No silent no-op was found on this SHA.** That is the RB05 exit criterion, met
by a rescan rather than by assertion.

## REMOVED

Five exported components have no render site. Each was verified by searching the
whole app, not only its own file:

| Component | Evidence |
|---|---|
| `components/diff/mobile-diff.tsx:MobileDiff` | referenced only by `e2e/v110/code.spec.ts:71`, whose comment states it "is exported but has no render site" |
| `components/workspace-tabs-bar.tsx:WorkspaceTabsBar` | only its definition, its own unit test, and five e2e comments that each say it is exported and never mounted |
| `components/presence/presence-indicator.tsx:PresenceIndicator` | zero references anywhere |
| `components/session/session-context-tab.tsx:SessionContextTab` | zero references anywhere |
| `pages/workbench/skill-picker.tsx:SkillPicker` | zero references anywhere |

These are the `code.diff` and `shell.workspace-tabs` anchors the e2e suite
already quarantines. They are dead code, not pending work: the fix is deletion,
which is a separate card.

## The "soon" controls (FX00 input)

Every one of these renders **disabled and labelled** — `aria-disabled="true"`
with a `common.comingSoon` tooltip, or `disabled` with `data-soon` and a hint —
and none carries a handler. That is the RB07-compliant shape the goal requires,
and it is applied consistently.

| Surface | Control | Site |
|---|---|---|
| Work | Auto-safe selector, Plan AI, Undo | `work-cockpit.tsx:78-80` |
| Work | Plan row Run | `work-cockpit.tsx:118`, `:224` |
| Work | Policy | `work-cockpit.tsx:207` |
| Work | Approve | `work-cockpit.tsx:257` |
| Code | Add context source | `code-inspector/context.tsx:81` |
| Code | Checkpoint, Compare, Branch | `code-inspector/history.tsx:46`, `:57`, `:58` |
| Code | Related search | `code-inspector/search.tsx:76` |
| Code | Symbols | `code-inspector/symbols.tsx:63` |
| Code | Problems / Output / Tests / Debug / Ports tabs | `terminal-panel-chrome.tsx:42`, `:47` |
| Code | Split terminal, Agent terminal | `terminal-panel-chrome.tsx:78`, `:82` |
| Account | Join org, Create org, Join (short) | `account-overview.tsx:60-61`, `account-organisations.tsx:22-23` |
| Account | Passkeys, Recovery, Revoke other sessions | `account-security.tsx:46`, `:52`, `:64` |
| Account | Personal profile fields | `account-personal.tsx:111`, `:119` (`title={soon()}`) |
| Settings | AI preferences (2), Compute card + policy, Hooks, Network, System | `settings-ai-preferences.tsx:103,122`, `settings-compute.tsx:57,69`, `settings-hooks.tsx:31,61`, `settings-network.tsx:70,79`, `settings-system.tsx:225` |
| Design | Studio tools, Format, Page actions, New page | `design/runtime/studio-panel.tsx:54,107,208,212` |
| Automate | Run bar Test, Fixture, To Work | `automate-studio-run-bar.tsx:96,123,152` |

Two ADR references are cited in the code for this pattern: ADR-047 ("visual +
greyed") and ADR-085.

## One visible claim with no engine

`pages/session/code-inspector/overview.tsx:73-75` renders a **Completion** card
whose body is `inspector.code.overview.completionHint`:

> "Ghost text and Next Edit are independent of Ask / Assist / Build / Auto. The
> LSP stays deterministic, without an LLM."

Neither capability exists anywhere in the shipped source: `ghostText`,
`inlineAi`, `inlineSuggest` and `nextEdit`/`NextEdit` return **zero** matches
across `packages/app/src`, `packages/ui/src` and `packages/unifia/src`. This is
not a disabled control — it is an active, affirmative statement about two
features that do not exist, and it is the one place in this scan where the UI
tells the user something untrue.

It is left in place deliberately: rewording it is a product copy decision, and
the key lives under the `inspector.` prefix rather than the four prefixes the
parity test polices, so a fix would not be caught by translation CI either way.

## FX00 — NEEDS-OWNER RB07

`DECISIONS.md` lists the policy for "soon" controls as **open decision O1**:
*"Politique des contrôles « SOON » : implémenter maintenant ou masquer jusqu'au
train concerné (RB07, FX00)"*. It is not among D1–D14, and the file's own header
states D9–D11 and the open decisions have not been settled.

**No owner policy exists to apply.** Therefore, per the card:

- `NEEDS-OWNER RB07` — decide whether a "soon" control ships visible-and-greyed
  in release 1, or is hidden until its train.
- **All such controls stay disabled and labelled** until that decision. Nothing
  in this card enables, deletes or relabels one.
- The completion-hint sentence above is part of the same question and is left
  untouched for the same reason.

## What this card does not claim

- Not a behavioural audit. 821 REAL means "has a handler and no disable marker",
  not "does the right thing"; the census tool says of itself that "handlers and
  labels do not prove behavior or visibility".
- The 15 spread-only candidates cannot be classified from the element and were
  not individually read. 26 further candidates carry a spread *and* a handler,
  so the 42 spread-carrying candidates overall are not one class.
- CONDITIONALLY_DISABLED rows were counted, not individually read.
- The `codeLens` measurement (zero matches across the three packages) is what
  B3 uses to call code lens engine-less; it is not itself a control
  classification.