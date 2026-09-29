<!-- SPDX-License-Identifier: MIT -->
# CODEQL-TRIAGE — alertes ouvertes sur dev (carte QA04, 2026-09-30)

Source : `gh api "repos/Rwanbt/unifia/code-scanning/alerts?state=open&ref=refs/heads/dev"` → **759 alertes** (suite `security-and-quality`). Répartition dominante : 98 notes `unused-local-variable`, 37 `trivial-conditional`, 21 `property-access-on-non-object`, puis les règles de sécurité. Dispositions **proposées** ; rien n'a été rejeté (« dismissed ») sur GitHub.

## Bruit hors code livré (config : PR #140)
`docs/` (maquette HTML v110 : 16 `remote-property-injection` « high » en boucle sur un fichier `.html`), `tools/`, `scripts/`, `github/` (paquet GitHub Action), `packages/console` (non livré, voir `SHIPPED-REACHABILITY.md`), tests, e2e, stories. Exclus de l'analyse ; suite ramenée à `security-extended`.

## Code livré (packages/*/src) — medium et plus
| Règle | Où | Disposition |
|---|---|---|
| `biased-cryptographic-random` ×4 (high) | `util/identifier.ts`, `unifia/id/id.ts`, `plugin/codex.ts` (PKCE), `server/routes/voice-live.ts` | **CORRIGÉ** (PR #139, `randomString` sans biais de modulo) |
| `insufficient-password-hash` | `voice-live.ts:97` | **FAUX POSITIF** : c'est la signature HMAC-SHA256 d'un JWT HS256 avec la clé API, pas un hachage de mot de passe |
| `insufficient-password-hash` | `server/workbench.ts:95` (`sha256(password)` = clé de signature des jetons) | **À DÉCIDER** : dérivation rapide d'un secret ; acceptable si le mot de passe est généré (fort), faible s'il est choisi par l'utilisateur ; correctif proposé : HKDF/scrypt (invalide les jetons en cours, sans migration) |
| `command-line-injection` ×2 critical, `indirect-…`, `shell-command-injection-from-environment` | `unifia/util/process.ts:63` | **ACCEPTÉ (nature du produit)** : c'est le lanceur de commandes que l'utilisateur autorise via les permissions de l'outil bash ; à revérifier par lecture (aucun appelant qui passe une entrée réseau non autorisée) |
| `command-line-injection` critical | `unifia/script/cargo-proxy.mjs:179` | **HORS LIVRÉ** (script de build) |
| `request-forgery` critical | `github/index.ts:465` | **HORS LIVRÉ** (GitHub Action) |
| `insecure-temporary-file` ×7 | `local-llm-server/index.ts`, `util/filesystem.ts`, `secret-broker/os-broker.ts:451`, `desktop-electron/main/cli.ts` | **À REVOIR** : fichiers créés dans des dossiers de données de l'application ; vérifier qu'aucun n'est dans un répertoire partagé (`os.tmpdir()`) |
| `file-system-race` ×12 (high) | `mobile-entry.ts`, `tool/apply_patch.ts`, `secret-broker/os-broker.ts`, `workspace-runtime/index.ts:286`, `knowledge/*`… | **À REVOIR** : motif « vérifier puis utiliser » ; le plus sensible est `secret-broker` et `workspace-runtime` |
| `polynomial-redos` ×7 (high) | `artifact-render/{annotate,bridges/palette,srcdoc}.ts`, `contracts/workflow-graph.ts:210`, `design-system-runtime/parse-design-md.ts`, `skill-hub/skill-manifest.ts:178` | **À CORRIGER** : analyse d'entrées non fiables (artefacts, manifests) : expressions à durcir ou à borner en longueur — lot dédié |
| `incomplete-sanitization` ×5 | `unifia/cli/cmd/run.ts:313`, `desktop-electron/main/apps.ts:23`, `console/core/script/*` | **À REVOIR** (les 3 scripts console sont hors livré) |
| `double-escaping` | `ui/context/marked.tsx:75` | **À REVOIR** (rendu markdown : vérifier l'ordre des échappements) |
| `http-to-file-access` / `file-access-to-http` ×10 | `util/filesystem.ts`, `util/log.ts`, `github/auth.ts`, `auth/index.ts:233` | **ATTENDU** pour un outil qui écrit ses jetons et journaux ; vérifier que les données écrites sont masquées (log) |
| `log-injection` ×3 | `github/index.ts` (hors livré), `app/components/terminal.tsx:280` | **À REVOIR** pour le terminal |
| `prototype-polluting-assignment` ×2 | `sdk/js/src/v2/gen/core/params.gen.ts` | **GÉNÉRÉ** (SDK) : exclure ou rejeter les clés `__proto__` côté générateur |

## Suite proposée (par ordre de valeur)
1. Lot `polynomial-redos` (7, entrées non fiables).
2. Décision sur la dérivation du secret de signature (`workbench.ts`).
3. Relecture des `file-system-race` de `secret-broker` et `workspace-runtime`, puis des fichiers temporaires.
Chaque lot = une PR ≤ 400 lignes avec test de régression (entrée pathologique bornée en temps).
