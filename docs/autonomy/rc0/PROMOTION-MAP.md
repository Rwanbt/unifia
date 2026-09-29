# PROMOTION-MAP — synchronisation P0 `dev` ← `new-ui` (carte RB02, mesurée le 2026-09-29)

## Ascendance (voir BASELINE-RC0.md)
`work-design`, `dev`, `main` sont des ancêtres de `new-ui` (0 commit propre). SHA de retour arrière : `dev` = `95350647140a382ee6d5d61bc2f6639597d80f0b`, `main` = `207ff452b8056ae11d1f71e23198e520835f70ed`.

## Delta
`git diff --shortstat origin/dev origin/new-ui` : 2410 files changed, 458838 insertions(+), 192218 deletions(-) ; 651 056 lignes (numstat brut). Très au-delà de 400.

## Gate de taille
`scripts/check-pr-size.sh` : `git diff --numstat "$base_ref"` (arbre de travail vs base), exclut lockfiles et `dist|build|target|generated`, échoue si > 400. Lancé par `work-design-integrity.yml` (job `merge-and-size`, PR vers `dev`, filtre de chemins `packages/**`, `scripts/check-pr-size.sh`…). Ce workflow n'est **pas** dans les checks requis de `dev` (liste ci-dessous) : il ne bloque donc pas la fusion, il échoue seulement en rouge.

## Protection des branches (API GitHub)
| | `dev` | `main` |
|---|---|---|
| Checks requis | check-compliance, check-standards, conformance, rust unit tests, sdk in sync with server, unit (linux), unit (windows) | idem |
| Revue PR requise | non | 1 approbation |
| **required_linear_history** | **true** | **true** |
| enforce_admins | false (le propriétaire peut contourner) | false |
| Force-push / suppression | interdits | interdits |
| Résolution des conversations | requise | — |
Aucun ruleset de dépôt (`[]`). `new-ui` : non protégée.
Aucun des 7 checks requis n'est conditionné par chemin dans les fichiers lus (à re-vérifier en QA00).

### ⚠ Constat bloquant pour l'option A (D10)
`required_linear_history: true` **interdit les merge commits** sur `dev`. Options de fusion restantes via l'interface : squash (efface l'historique de 1457 commits) ou rebase (réécrit les SHA : `dev` ne serait plus un ancêtre de `new-ui`, divergence permanente). Aucune ne convient. Voie retenue (voir EXECUTION-LOG) : PR de promotion en *merge commit* après **désactivation temporaire** de `required_linear_history` sur `dev`, réactivée aussitôt après la fusion.

## Effets de bord d'un push sur `dev` (fusion de la PR de promotion comprise)
| Workflow | Se déclenche pour le delta ? | Effet sortant |
|---|---|---|
| containers.yml | oui (`packages/containers/**`, `package.json` changent) | pousse des images vers ghcr.io |
| generate.yml | oui (sans filtre) | commit bot `git push origin HEAD:dev` |
| nix-hashes.yml | oui (`bun.lock`, `package.json`, `patches/**`…) | peut pousser un commit bot (l.149) |
| publish.yml | oui (push `dev`) | jobs `version`, `build-cli`, `sign-cli-windows` gardés par `github.repository == 'anomalyco/opencode'` ; `build-tauri`/`build-electron` dépendent (`needs`) de ces jobs → sautés (à confirmer job par job en QA14) |
| android.yml | oui (`packages/mobile/**`…) | upload-artifact seulement (build APK) |
| codeql, test, typecheck, nix-eval, storybook, release-github-action | selon filtres | aucun effet sortant (CI) |
| docs-locale-sync.yml | — | désactivé (`if: false`) |
| release.yml | non (déclenché par tag `v*`) | — |

Décision O5 (propriétaire, 2026-09-29) : effets de bord refusés → `containers.yml`, `generate.yml`, `nix-hashes.yml` sont désactivés (`gh workflow disable`) avant la fusion et réactivés après.

## Options P0
- **A (retenue)** : PR `promote/new-ui-baseline` → `dev`, *merge commit*. Prérequis : exemption du gate de taille (non requis, donc informative), désactivation temporaire de `required_linear_history`, workflows à effets de bord désactivés.
- B : poussée directe — refusée par le propriétaire.
- C : tranches ≤ 400 lignes — écartée (2410 fichiers).

## Fin de cycle
Promotion `dev` → `main` : PR du propriétaire (1 approbation requise sur `main`), 7 checks verts, tag `vX.Y.Z` par le propriétaire, publication par `release.yml`.
