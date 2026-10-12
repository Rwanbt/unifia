<!-- SPDX-License-Identifier: MIT -->
# RC-0 Storybook docgen scope qualification

## Reproduced cause

The pinned storybook-solidjs-vite 10.5.2 component-meta transform accepts every
JSX module, including node_modules. Its manager resolves the nearest tsconfig
for each component. A dependency without its own tsconfig reaches the repository
root config, which includes the entire workspace by default.

The unchanged Linux profile in #191 reaches 6004 MiB heap before rendering and
exhausts the unchanged 6144 MiB budget before its first chunk. Grammar modules
are absent during the first large allocation, so removing grammars is unjustified.

An isolated Node witness extracting @solidjs/meta/dist/index.jsx loads the root
tsconfig with 3528 root files, produces zero component metadata, and retains
3945 MiB heap after GC (31 MiB before). Disposal reduces it to 337 MiB.
The full local attribution build reports 3939 MiB on that dependency transform
and reproduces heap exhaustion, exit 134.

## Correction and contract

Patch the pinned transform to return null for node_modules path segments before
creating a TypeScript project. Normalize Windows separators first. Source and
distributed runtime receive the same guard; the patch is declared in the manifest
and lockfile. Unifia component transforms, stories, Docs, Controls and component
manifest generation remain enabled. No memory budget is raised.

## Local proof

- Frozen installation accepts the versioned patch. Bun patch --commit twice
  failed with Windows rename EPERM; the equivalent explicit patch was installed
  and verified, without bypassing hooks or integrity checks.
- Three package tests pass, six assertions, 11.53s: external JSX stays below
  a 64 MiB allocation budget, Windows paths reject, Button retains Controls metadata.
  Targeted test typecheck passes. These tests are wired into Turbo test:ci.
  Initial CI-script witness passed tests but failed to write JUnit (missing
  directory); the script now creates it, and report existence is checked.
- Same 6144 MiB Node build passes, exit 0; Vite duration 51.98s. Render-start
  heap/RSS 2944/3451 MiB, first chunk 3031/3493 MiB, completion 2244/3450 MiB.
- All 1628 transformed modules, 244 grammar modules and 448 chunks remain.
  The complete story index is identical (204 entries); component payloads are
  identical (55 components), excluding only manifest timing metadata.

Logs and before-build references are in rc0-agent/.build-temp/rc0-storybook-*20261001*.
Linux CI passes at 0868c7e463 (run 36912531347): Vite 36.16s, render-start
heap/RSS 2312/2791 MiB, completion 2252/3022 MiB, same modules/grammars/chunks.
Windows job 110538449565 passes all three new docgen tests but fails the old
recall-content fixture. #195 separately qualifies that fixture and is merged
on dev 84d4030c59; this branch incorporates it for a fresh required-check run.
Existing full Storybook typecheck failures, physical qualification and QA12R
remain open.
