# CARD CR03 — `workflow.run` via step-up (décision D1 = A) — PRÉPARER, NE PAS FUSIONNER

**But :** rendre `workflow.run` éligible au step-up : un jeton de base ne peut pas lancer un run, mais peut atteindre la porte d'approbation ; chaque run exige une approbation explicite. **C'est un changement de politique de sécurité : le propriétaire relit et fusionne lui-même.**
**Dépend de :** RB01 et P0 (`dev` = baseline). **Branche :** `agent/cr03-workflow-run-step-up` depuis `origin/dev`. **PR vers `dev`, ≤ 400 lignes.**
**Fichiers autorisés :** `packages/workbench-server/src/constants.ts`, `packages/workbench-server/src/server-helpers.ts` (commentaire seulement), `packages/workbench-server/test/capability-scope.test.ts`, `packages/workbench-server/test/surface-capability.test.ts` (seulement si son pin de liste l'exige), `docs/audit/AUDIT-CABLAGE-NEW-UI-2026-09-30.md` (mise à jour de la section 4), `docs/autonomy/rc0/EXECUTION-LOG.md`. **Tout autre fichier = STOP.**

## Faits vérifiés dans le dépôt (à re-vérifier avant de modifier)
- `packages/workbench-server/src/constants.ts:43` : `STEP_UP_ELIGIBLE_CAPABILITIES = new Set(["artifact.create", "artifact.export"])`.
- `packages/workbench-server/src/server-helpers.ts` (`checkCapability`, ≈ l.111-135) : refus 403 si `!principal.scopes.has(cap) && !STEP_UP_ELIGIBLE_CAPABILITIES.has(cap)` ; sinon passage par le gate ; réponse `202 { approvalRequired, approvalId, capability }` si le gate demande une approbation.
- `packages/workbench-server/test/capability-scope.test.ts` : la route `workflows.start` est dans `NEVER_GRANTED_ROUTES` (≈ l.40) et le test « workflow.run is never granted in this branch, even if the gate would allow it » (≈ l.91) attend **403**.
- `SURFACE_GRANTED_CAPABILITIES` (constants.ts) ne contient volontairement pas `workflow.run` : « Installs, workflow runs and desktop control … still go through the broker ». **Ne l'élargis pas.**
- L'audit `AUDIT-CABLAGE-NEW-UI-2026-09-30.md` §4 indique que l'interface gère déjà « approbation requise → autoriser → relancer » et que le reste du chemin est vérifié de bout en bout quand `workflow.run` est dans le bail (`packages/unifia/test/server/workbench-automate-run.test.ts`).

## Étapes
1. Recense **toutes** les routes qui exigent `workflow.run` : `grep -rn '"workflow.run"' packages/workbench-server/src packages/unifia/src packages/app/src`. Liste-les dans le checkpoint.
2. `constants.ts` : ajoute `"workflow.run"` à `STEP_UP_ELIGIBLE_CAPABILITIES` ; mets à jour le commentaire qui dit que `artifact.create/export` sont « the only two » ; explique le pourquoi (décision D1 du 29/09/2026 remplaçant celle du 17/08).
3. `capability-scope.test.ts` : (a) retire `workflows.start` de `NEVER_GRANTED_ROUTES` et ajoute-la à `STEP_UP_ROUTES` ; (b) remplace le test « never granted » par : « workflow.run is step-up eligible: a read-only token reaches the gate and gets 202 approvalRequired, and creates exactly one approval » ; (c) ajoute un test **négatif** : un jeton sans approbation ne démarre pas de run ; (d) ajoute un test **fail-closed** : si le gate refuse, la réponse reste un refus et aucun run n'est créé.
4. Vérifie que `surface-capability.test.ts` épingle toujours la liste des capacités accordées sans `workflow.run` (ne change son contenu que si le test échoue pour une raison légitime, et explique-la).
5. Cherche le chemin de **révocation** : `grep -rn "revoke" packages/workbench-server/src`. Si une révocation d'approbation/jeton existe, ajoute un test « après révocation, le run est refusé ». **Si elle n'existe pas pour ce cas, ne l'invente pas** : note-le comme sous-carte CR03b et rapporte (le critère « révocable » du graphe reste alors ouvert).
6. Vérifie la visibilité UI : `packages/app/src/pages/workbench/automate-surface.tsx` et `automate-run-state.ts` — le prompt d'approbation est-il affiché et le relancement fonctionne-t-il ? Note la réponse avec `fichier:ligne`. Ne modifie pas l'UI dans cette carte.
7. Mets à jour `AUDIT-CABLAGE-NEW-UI-2026-09-30.md` §4 (« Décision qui revient au propriétaire ») : décision D1 = A, PR liée.

## Preuves attendues (toutes)
- `bun run --cwd packages/workbench-server test` (bun test + vitest) : sortie complète ; `bun --cwd packages/workbench-server run typecheck`.
- `bun test packages/unifia/test/server/workbench-automate-run.test.ts` (ou la commande du paquet `unifia`) : parcours démarrer/approuver/exécuter/lister/annuler.
- `node scripts/check-workbench-security.mjs` et `node scripts/check-capability-lease-parity.mjs`.
- `bunx biome check` sur les fichiers modifiés.

## Checkpoint et STOP
Commit `feat(workbench): make workflow.run step-up eligible`. **STOP après la préparation** : rapporte au propriétaire le diff, les tests et la question de révocation. **Ne fusionne jamais cette PR** : c'est une exception à la règle D11. STOP aussi si un test hors périmètre casse : classe l'échec (préexistant ou régression) avec les logs avant toute modification.
