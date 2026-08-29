# TEST-MATRIX — Sovereign Knowledge Core V1

> Matrice de validation. Pour chaque carte : tests écrits, commande
> exacte, résultat attendu, statut réel.

## Validations canoniques (runbook §22)

| Validation | Commande | Cible | Statut |
|---|---|---|---|
| contracts typecheck | `bun --cwd packages/contracts typecheck` | packages/contracts | _à exécuter_ |
| contracts test | `bun --cwd packages/contracts test` | packages/contracts | _à exécuter_ |
| unifia typecheck | `bun --cwd packages/unifia typecheck` | packages/unifia | _à exécuter_ |
| unifia test | `bun --cwd packages/unifia test` | packages/unifia | _à exécuter_ |
| app typecheck | `bun --cwd packages/app typecheck` | packages/app | _à exécuter_ |
| app test | `bun --cwd packages/app test` | packages/app | _à exécuter_ |
| desktop typecheck | `bun --cwd packages/desktop typecheck` | packages/desktop | _à exécuter_ |
| desktop build | `bun --cwd packages/desktop build` | packages/desktop | _à exécuter_ |
| mobile typecheck | `bun --cwd packages/mobile typecheck` | packages/mobile | _à exécuter_ |
| mobile test | `bun --cwd packages/mobile test` | packages/mobile | _à exécuter_ |
| lint | `bun run lint` | racine | _à exécuter_ |
| diff check | `git diff --check` | worktree | _à exécuter_ |
| `bun test` racine | (interdit) | — | — |

## Crates Rust

| Crate | Validation | Statut |
|---|---|---|
| `crates/unifia-kokoro-shared` | fmt + clippy + test | _à exécuter_ |
| `crates/unifia-supervisor` | fmt + clippy + test | _à exécuter_ |
| `crates/unifia-knowledge-core` (cible) | fmt + clippy + test | _à créer_ |
| `packages/desktop/src-tauri` | fmt + clippy + test | _à exécuter_ |
| `packages/mobile/src-tauri` | fmt + clippy + test | _à exécuter_ |

## Cartes × tests

(rempli au fil de l'eau par chaque carte)
