<!-- SPDX-License-Identifier: MIT -->
# BASELINE-RUN — mesure locale de new-ui@2c13b7d (carte RB03, 2026-09-29)

Machine du propriétaire, Windows 11, bun 1.3.14, node 22.15. Mesure seulement : rien n'est corrigé. Worktree `.worktrees/rc0-agent` (baseline + 2 commits de docs). Statut RB03 : **PARTIEL** (preuve locale ; preuve CI par PR = #119).

| Commande | Résultat | Durée | Classification |
|---|---|---|---|
| `bun install --frozen-lockfile` | 1re passe : 28 paquets `EBUSY` (exit 1) ; 2e passe OK (2782 installs) | 67 s | environnemental (Windows, fichiers verrouillés), transitoire |
| `bun turbo typecheck --concurrency=1` | 47/47 OK — **100 % cache local** (FULL TURBO), pas de recompilation | 2 s | valide mais non frais ; refaire avec `--force` en QA |
| `check-package-wiring.mjs` | OK : 25 atteints, 27 déclarés non livrés (= attendu) | 1 s | — |
| `check-workbench-security.mjs` | **FAIL** : `'allow-same-origin'` dans `packages/contracts/src/browser.ts:85` (ADR-1035) | 2 s | réel, à traiter (Browser/sécurité) |
| `check-workbench-test-boundary.mjs` | OK | <1 s | — |
| `check-capability-lease-parity.mjs` | OK (4 capacités) | <1 s | — |
| `unifia-conformance.mjs` | 8/8 PASS ; Gate B = GO ; **Gate C = NO-GO** (2 bloquants : Marketplace content-first ; Aucun P0/P1 sécurité) | 28 s | attendu |
| `workbench-server test` | 48 (bun) + 54 (vitest) OK | 13 s | — |
| `bun run test:unifia` | 5234 pass, 11 skip, **23–24 fail** (486 fichiers) | ~10,7 min | voir ci-dessous |
| `packages/app test:unit` | 2069 pass, 1 skip, 0 fail | 15 s | — |
| E2E (`test:e2e`) | non exécuté : Playwright exige `PLAYWRIGHT_WORKERS=1` et des backends dédiés ; couvert par la CI `e2e (linux)` | — | — |

## Échecs de `test:unifia` (2 passes : 24 puis 23, un flaky)
- Registre d'outils (`tool.registry`, 9 tests : `.opencode/tool(s)`, websearch/SearXNG, local-llm × 4, dépendances externes)
- Config plugins/TUI (6 : tuple specs, managed tui config, metadata, ordre des clés de `permission`, custom npm provider)
- `getSmallModel` ×2, `file.ripgrep` (include hidden), `tool.bash` permissions imbriquées
- `hooks — hookPrePush` ×2 (REBASE_HEAD, branche protégée) : sensibles à l'état git du worktree
- `memory tools — reachability` ×2 (outils mémoire enregistrés / désactivés)
Classification **provisoire** : préexistants sur cette machine, cause non isolée (probable mélange Windows/worktree/`.opencode` et régressions réelles sur registre d'outils et mémoire). À trier en QA03 avec logs par test ; aucun n'est marqué « flaky connu » sans preuve. Comparaison avec #56/#57/#58/#55 non faite (issues non relues, RB01).

## Constat CI (PR #119, requis sur dev)
Sur le SHA baseline 2c13b7d : `sdk in sync with server` **échouait** (openapi.json périmé, +38 lignes : websearch/searxng_url, permissionMode). Corrigé par régénération (`51efa40`). Non requis mais rouges : `android cross-compile`, `check`, `sdk-drift`, `voice-host python`, `merge-and-size` (attendu).
