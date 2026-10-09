<!-- SPDX-License-Identifier: MIT -->
# HANDOFF — Unifia RC-0, état au 2026-09-30 (fin de la session Claude Code)

Objectif du propriétaire (Erwan, `Rwanbt`) : **autonomie complète tant que le plan ne touche pas `main`**. Le travail automatisé s'arrête à `dev` ; lui seul promeut `dev` → `main`, tague et publie. Répondre en français. Journal détaillé : `docs/autonomy/rc0/EXECUTION-LOG.md` (miroir : `D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\Unifia-RC0\`).

## 1. Décisions déjà prises (ne pas rouvrir)
D10 = A (P0 par PR, fait) · D11 = les agents fusionnent eux-mêmes (le propriétaire a **délégué aussi CR03, `.github/**`, workflows**) · O5 = effets de bord refusés : `containers.yml`, `generate.yml`, `nix-hashes.yml` sont **désactivés** (`gh workflow disable`), les laisser ainsi · pas de bêta, pas de tag, jamais de push sur `main`. `dev` exige historique linéaire → **squash merge** par PR.

## 2. État du dépôt (`Rwanbt/unifia`)
- `origin/dev` = `6f373d8d49` (P0 = `ff3047f`, puis ~20 PR squashées). `main` = `207ff45` (non touché).
- **PR ouvertes** :
  - #138 CR05 (reclaim d'un run d'une session antérieure) : 7 checks requis verts sauf `unit (windows)` en échec **transitoire** (`sdk-shared` build exit 2, course de build Windows) → relancer le job échoué quand le run est terminé.
  - #140 QA04 (config CodeQL : `paths-ignore` + `security-extended`) : `unit (windows)` en échec sur un test à budget 500 ms (`File.write … LSP notify`) sans lien → corrigé par #144 ; relancer.
  - #143 CR04 tranches 2-3 (le studio envoie les arêtes dessinées, éditeur de réglages `control.if`/`control.merge`) : en attente de `unit (linux)`.
  - #144 QA02 (garde « se termine avant 10 s » au lieu de < 500 ms) : en attente de `unit (windows)`.
  Procédure : quand les **7 checks requis** (`check-compliance`, `check-standards`, `conformance`, `rust unit tests`, `sdk in sync with server`, `unit (linux)`, `unit (windows)`) sont verts → `gh pr merge N --repo Rwanbt/unifia --squash --subject "<titre>"`. Si `BLOCKED` alors que tout est vert : il y a des **fils de revue CodeQL non résolus** (règle « résoudre les conversations ») → commenter la raison puis `resolveReviewThread` (GraphQL).
- **Worktrees** (dans `D:\App\unifia\unifia\.worktrees\`) : `rc0-agent` (branche `agent/rc0-pack`, docs seulement), `lot` (worktree de lot réutilisable, `node_modules` installés, on y fait `git checkout -B agent/<id> origin/dev`), `doc01` (obsolète). Le checkout principal `D:\App\unifia\unifia` est sur `main` avec des fichiers non suivis : **ne pas y travailler**.

## 3. Ce qui est FAIT sur dev
P0 · DOC01 · CR02 (déjà corrigé) · CR03 (`workflow.run` step-up) · CR06 (mutation d'état de tâche + Kanban glisser-déposer) · CR07 (déjà livré) · CR08 (code lens / IA inline **déclarés indisponibles**) · CR09 (i18n Design) · CR04 tranche serveur (graphe dessiné exécuté, `$node` dans les conditions) · QA00, QA02 (2 flakes), QA05 (triage), QA06, QA07 (vérifié, non corrigé), QA14 (analyse) · VO01 (Voice intégrée par domaine) · QA04 partiel (#139 tirages sans biais, #141 ReDoS ×7, #142 scrypt) · RB00-RB04, VO00.

## 4. Reste à faire (ordre proposé)
1. Fusionner #138, #140, #143, #144 (voir §2).
2. **CR01 (#77)** bloqué : lire `CR01-DIAGNOSIS.md` (Runner innocent ; 2e `loop` après cancel perd le contexte ALS ; 3 hypothèses réfutées). Option A recommandée : reproduire en e2e réel avec journalisation avant toute correction.
3. **CR04** : e2e Playwright navigateur (dessiner, configurer, lancer une branche) ; CR10 = gate du parcours critique (inclut e2e « Kanban survit au rechargement »).
4. **QA04 suite** (`CODEQL-TRIAGE.md`) : `file-system-race` de `secret-broker` et `workspace-runtime`, fichiers temporaires, `incomplete-sanitization` (`cli/cmd/run.ts:313`, `desktop-electron/main/apps.ts:23`), `double-escaping` (`ui/context/marked.tsx:75`).
5. **CI de `dev` rouge** (non requis mais à réparer, la règle projet dit « corriger toutes les erreurs ») : `Build Android APK` (sdkmanager échoue sur le runner), 2 tests Rust de `runtime.rs` (`embedded_server_keeps_parent_watchdog_stdin_open`, `smart_turn_gated_corpus_meets_the_policy_c_budgets_and_parity`), `voice-host python`, `check-workbench-security` (`allow-same-origin` dans `packages/contracts/src/browser.ts:85`, décision Browser/sécurité).
6. Tâches d'inventaire restantes : RB05 (table de vérité des contrôles visibles), RB06, RB07, FX00/FX01 (actions Work), PW00/PW01 (câblage `capability-runtime`), UI00 (parité v110), QA03 (CI lente), QA09/QA10, puis gate **QA12R** sur un SHA immuable de `dev`, RL00-RL02 (gel, paquet de release, aligner `work-design`).
7. **Ce que seul le propriétaire peut faire** : tests physiques Android/Windows (VO02-VO05, QA08), RL03-RL07 (tests manuels, PR `dev`→`main`, tag, publication), décisions de `RELEASE-PIPELINE.md` (numéro de version, `NPM_TOKEN` absent, signature Windows absente, npm+ghcr au tag), sort de `packages/console` (`curl unifia.ai/install`), réactivation éventuelle des 3 workflows désactivés.

## 5. Pièges appris (à respecter)
- **Modèle de PR obligatoire** (`.github/pull_request_template.md`, sections Issue / Type de changement coché / What / How verified / Screenshots / Checklist 2 cases cochées), sinon `compliance-close` ferme la PR après 2 h. Titres `feat|fix|docs|chore|refactor|test` ; sur `dev`, `fix`/`chore` restent `needs:issue` (les mots-clés de fermeture ne comptent que vers `main`) → préférer `feat`/`refactor`. Utiliser `gh pr create --body-file`.
- **CI très lente et coûteuse** : chaque push sur `dev` lance toute la suite ; `unit (windows)` ≈ 30-60 min, `e2e (linux)` ≈ 1 h 45 (non requis). Ne pas ouvrir plus de 3-4 PR en parallèle ; fusionner par lots. `gh run rerun --failed` est impossible tant que le run contient un job en cours.
- **Flakes Windows connus** : tests à budget de temps (`live-controller` G6 corrigé ; `File.write` corrigé dans #144), course de build turbo (`sdk-shared`, `.d.ts` tronqué « Unterminated string literal ») → rerun.
- **Hook husky** (pre-commit) : en-tête `SPDX-License-Identifier: MIT` obligatoire sur tout **nouveau** `.ts/.tsx/.rs/.md` ; pre-push = `turbo typecheck` complet (le push échoue parfois deux fois de suite de façon transitoire : réessayer).
- **Windows** : `bun install` peut sortir `EBUSY` (relancer) ; `TEMP`/`TMP` doivent pointer vers un dossier du disque D: (`D:\App\unifia\unifia\.worktrees\rc0-agent\.build-temp`) ; `bun turbo typecheck --concurrency=1` sur cette machine ; `PLAYWRIGHT_WORKERS=1` ; les worktrees imbriqués sous le checkout principal voient `.opencode/tool` du parent → ~23 tests `test:unifia` en échec **local** seulement (la CI est verte) ; ne pas supprimer un dossier de worktree (chemins trop longs) — utiliser `git worktree remove`.
- **Tests des paquets** : `packages/workbench-server` liste ses fichiers de test explicitement dans `package.json` (un nouveau test n'y tourne pas tant qu'il n'est pas ajouté) ; lancer les tests depuis le dossier du paquet.
- **SDK** : toute route Hono qui change exige `./script/generate.ts` puis commit de `packages/sdk` (check requis « sdk in sync with server »).
- **`CLAUDE.md`/`AGENTS.md`** du dépôt : pas de `sed`/regex sur le code source, 3 échecs → arrêt et diagnostic, causes racines avant correctif. Règles globales de l'utilisateur : réponse en français, mise à jour du vault (`_memory`, `LOG.md`) en fin de session, pas de force-push sur branches partagées.

## 6. Commandes utiles
```
gh pr checks N --repo Rwanbt/unifia
gh run rerun <run-id> --repo Rwanbt/unifia --failed
gh api "repos/Rwanbt/unifia/code-scanning/alerts?state=open&ref=refs/heads/dev"
cd D:\App\unifia\unifia\.worktrees\lot && git fetch origin && git checkout -B agent/<id> origin/dev
```
Documents du pack : `docs/autonomy/rc0/` (`PLAN-RC0-FASTTRACK.md`, `DECISIONS.md`, `TASK-GRAPH-RC0.json` = 104 tâches avec dépendances, `cards/`, `STARTUP-PROMPT.md`). Mesures : `BASELINE-RC0.md`, `BASELINE-RUN.md`, `PROMOTION-MAP.md`, `VOICE-DIVERGENCE.md`, `ISSUE-DISPOSITION.md`, `RELEASE-PIPELINE.md`, `CODEQL-TRIAGE.md`, `DEPENDENCY-TRIAGE.md`, `SHIPPED-REACHABILITY.md`.
