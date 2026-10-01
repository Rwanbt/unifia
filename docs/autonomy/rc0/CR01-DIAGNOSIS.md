<!-- SPDX-License-Identifier: MIT -->
# CR01 — diagnostic (issue #77, arrêt après 3 hypothèses réfutées, 2026-09-29)

Statut : **symptôme #77 reproduit ; cause racine e2e non établie ; aucun correctif livré**. La règle anti-loop impose l'arrêt après 3 hypothèses réfutées (`CLAUDE.md`).

## Ce qui est prouvé
- Reproduction e2e de l'issue #77 confirmée sur `origin/dev` (`a134e27964`) le 2026-09-30 : séquence hang via le serveur LLM déterministe, clic Stop, vérification du retour à Send, soumission d'un second prompt dans la même session. L'attente d'une réponse « Recovered after stop » expire après 45 s (`packages/app/e2e/v110/cr01-stop-followup.spec.ts`, test local non commité). Le contexte Playwright montre les deux messages utilisateur, un assistant « Thinking » et le bouton Stop encore présent. La fixture termine avec une réponse encore en attente (1 queued response), preuve que le second appel n'a pas consommé la réponse mise en file.
- Commande : `cd packages/app && bun run test:e2e e2e/v110/cr01-stop-followup.spec.ts --workers=1 --retries=0` — échec reproductible, 1 test échoué ; `spawn EPERM` au premier lancement sandboxé, succès de démarrage après exécution autorisée. L'échec est un bug préexistant sur dev, pas une régression de la branche de sécurité.
- `Runner` n'est pas en cause : `cancel` passe l'état à `Idle` **avant** d'attendre la fin du fibre (`effect/runner.ts`, branche `Running`), et `test/effect/runner.test.ts` couvre déjà « work can be started after cancel » et « cancel does not deadlock when replacement work starts before interrupted run exits ». L'hypothèse de l'issue (le prompt suivant attend le `Deferred` d'un run mort) est **réfutée** par la lecture du code.
- Un test serveur (`SessionPrompt.loop` → `llm.hang` → `cancel` → `llm.text("recovered")` → 2e `loop`, timeout 10 s) **échoue** : le 2e `loop` lève `instance: No context found for instance` (ALS `Instance` perdu). Le témoin sans cancel (deux `loop` consécutifs) **passe** → l'échec dépend du cancel.
- Pile : le fibre du 2e run est démarré depuis une continuation déclenchée par `cross-spawn-spawner.ts:395` (`Deferred.doneUnsafe` sur l'événement `close` d'un process enfant), donc hors contexte `AsyncLocalStorage`. Lectures ALS synchrones rencontrées ensuite : `tool/registry.ts` (`Env.get` dans le filtre, puis `tool.init`), `bus/index.ts:171` (`publish`), `session/summary.ts:167`, `skill/index.ts:364`.

## Hypothèses testées et réfutées (aucune ne corrige le test)
1. `Env.get` du filtre du registre lu hors ALS → déplacé via `InstanceState.withALS` : l'erreur se déplace vers `tool.init`.
2. `tool.init` enveloppé dans `withALS` : l'erreur se déplace vers `Bus.publish`/`Skill.available`/`summary`.
3. Lier les écouteurs d'événements du spawner avec `AsyncResource.bind` : erreur inchangée.
Le motif est une traînée de lectures ALS synchrones sur toute la boucle, pas un point unique : arrêt de la chasse au cas par cas (mauvaise couche).

## Ce qui reste incertain
La cause immédiate du hang e2e : le second message et l'état Thinking sont visibles, mais l'absence de consommation de la réponse LLM indique que la progression s'arrête avant l'appel provider. Le lien causal avec la perte ALS démontrée dans le test direct reste une inférence à confirmer par instrumentation ciblée. Le symptôme de #77 est désormais reproduit avec le backend HTTP réel et une réponse LLM déterministe.

## Options (à trancher au prochain passage, 2 à 3)
A. Instrumenter le test de reproduction e2e déjà observé autour de `Fiber.interrupt` / `handle.abort()` / `status` et de l'entrée dans le transport provider : mesurer le point d'arrêt avant de modifier le noyau.
B. Traiter la fragilité ALS à la racine : démarrer chaque run (`startRun`) dans `Instance.restore(ctx, …)` et restaurer le contexte à chaque reprise de fibre (`Effect.provideService` d'un wrapper), plutôt que patcher chaque lecture. Touche le noyau de session : lot XL, décision d'architecture.
C. Supprimer les lectures ALS synchrones de la boucle de session (les remplacer par `InstanceState.context`) : large, mais mécanique.
Test de reproduction (patch) : conservé dans le journal de session, non commité tant qu'il échoue.

## Addendum — re-mesure synchronisée (2026-09-30)

La première expérience e2e de ce diagnostic cliquait Stop dès que le bouton affichait cet état, sans vérifier que la requête correspondant à `Reply.hang()` était déjà arrivée au serveur LLM. Elle ne prouvait donc pas encore que le transport amont était effectivement suspendu au moment de l'annulation.

Dans `a3-journey.spec.ts`, le test a été étendu pour attendre une activité LLM après le prompt suspendu, puis cliquer Stop, envoyer un second prompt et vérifier la réponse ainsi que le statut serveur `idle`. Deux exécutions du corps du test ont atteint ces assertions : activité LLM observée, prompt suivant reçu en 528/530 ms, réponse visible en 549/929 ms, statut `idle`. Ces exécutions utilisaient un compteur d'appels ; elles ne démontrent pas encore que le hit observé correspondait au prompt `hang()`. Le code courant renforce cette barrière en inspectant `llm.hits()` pour retrouver le contenu précis du prompt ; cette version finale n'a pas encore été exécutée.

Limite : les trois commandes Playwright locales (deux via `test:e2e:local`, une directement) ont cessé d'émettre après ces assertions et n'ont pas rendu le résumé final. Elles ont été interrompues après attente prolongée ; leurs codes de sortie sont donc des interruptions, pas des succès. `packages/app` `typecheck` passe ; `e2e/tsconfig.json` échoue sur de nombreux diagnostics préexistants hors du fichier modifié, et Biome ignore les fichiers e2e. Aucun correctif runtime n'a été appliqué.

Conclusion provisoire : le premier repro peut annuler pendant l'établissement de la requête, avant le hit provider ; c'est une hypothèse, pas encore une cause prouvée. Il faut d'abord obtenir un run e2e complet de la version finale synchronisée et mesurer le teardown Playwright ; ensuite seulement comparer avec le repro plus ancien qui échouait et décider si la perte ALS observée est causale.

## Addendum — completed synchronized run (2026-10-01)

On immutable `dev@100eae30735e753801e9e27c66e1bf40a12da62f`, the committed `packages/app/e2e/v110/a3-journey.spec.ts` completed with `1 passed (1.0m)` and exit code 0, including harness shutdown. Command from `packages/app`: `bun run test:e2e:local -- e2e/v110/a3-journey.spec.ts --workers=1 --retries=0`, with `PLAYWRIGHT_TIMEOUT=180000`, `PLAYWRIGHT_WORKERS=1`, and TEMP/TMP at the mandated RC-0 build directory on D:. Execution required leaving the Windows sandbox.

The test waits for the exact hanging prompt in `llm.hits()` before Stop, then proves a further provider call, the expected assistant response and server `idle` in the same session. This proves recovery for this synchronized scenario; it does not reproduce or explain the earlier direct-loop ALS failure, nor qualify real production providers or physical devices. No runtime correction was applied and issue #77 remains open. Next: compare the early-cancel scenario with this provider-confirmed cancellation before choosing a runtime change.

The disk blocker was resolved without discarding build artifacts: NTFS compression reduced 5,297,868,730 bytes to 2,637,042,351 bytes. One generated Rust library was temporarily copied to `C:\Users\barat\Documents\Unifia\rc0-disk-buffer`, verified by SHA-256, and restored compressed at its original path with the same hash. D: subsequently had 1,899,073,536 bytes free. Vault sync reached the validator outside the sandbox but remains refused (`validator-red`, 29 issues).
