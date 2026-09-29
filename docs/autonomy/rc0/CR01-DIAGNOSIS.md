<!-- SPDX-License-Identifier: MIT -->
# CR01 — diagnostic (issue #77, arrêt après 3 hypothèses réfutées, 2026-09-29)

Statut : **BLOQUÉ (aucun correctif livré)**. Règle appliquée : 3 échecs sur le même problème → arrêt et diagnostic écrit (`CLAUDE.md`, anti-loop).

## Ce qui est prouvé
- `Runner` n'est pas en cause : `cancel` passe l'état à `Idle` **avant** d'attendre la fin du fibre (`effect/runner.ts`, branche `Running`), et `test/effect/runner.test.ts` couvre déjà « work can be started after cancel » et « cancel does not deadlock when replacement work starts before interrupted run exits ». L'hypothèse de l'issue (le prompt suivant attend le `Deferred` d'un run mort) est **réfutée** par la lecture du code.
- Un test serveur (`SessionPrompt.loop` → `llm.hang` → `cancel` → `llm.text("recovered")` → 2e `loop`, timeout 10 s) **échoue** : le 2e `loop` lève `instance: No context found for instance` (ALS `Instance` perdu). Le témoin sans cancel (deux `loop` consécutifs) **passe** → l'échec dépend du cancel.
- Pile : le fibre du 2e run est démarré depuis une continuation déclenchée par `cross-spawn-spawner.ts:395` (`Deferred.doneUnsafe` sur l'événement `close` d'un process enfant), donc hors contexte `AsyncLocalStorage`. Lectures ALS synchrones rencontrées ensuite : `tool/registry.ts` (`Env.get` dans le filtre, puis `tool.init`), `bus/index.ts:171` (`publish`), `session/summary.ts:167`, `skill/index.ts:364`.

## Hypothèses testées et réfutées (aucune ne corrige le test)
1. `Env.get` du filtre du registre lu hors ALS → déplacé via `InstanceState.withALS` : l'erreur se déplace vers `tool.init`.
2. `tool.init` enveloppé dans `withALS` : l'erreur se déplace vers `Bus.publish`/`Skill.available`/`summary`.
3. Lier les écouteurs d'événements du spawner avec `AsyncResource.bind` : erreur inchangée.
Le motif est une traînée de lectures ALS synchrones sur toute la boucle, pas un point unique : arrêt de la chasse au cas par cas (mauvaise couche).

## Ce qui reste incertain
Que ce mécanisme soit celui de #77 en production : ce test reproduit une perte de contexte propre à l'enchaînement (process git en fin de run interrompu) sous Bun ; #77 décrit un « Thinking… » infini dans l'e2e avec backend réel, non reproduit ici.

## Options (à trancher au prochain passage, 2 à 3)
A. Reproduire #77 dans l'e2e réel (`packages/app`, `llm.hang`) avec journalisation autour de `Fiber.interrupt` / `handle.abort()` / `status` : mesurer d'abord, cause ensuite.
B. Traiter la fragilité ALS à la racine : démarrer chaque run (`startRun`) dans `Instance.restore(ctx, …)` et restaurer le contexte à chaque reprise de fibre (`Effect.provideService` d'un wrapper), plutôt que patcher chaque lecture. Touche le noyau de session : lot XL, décision d'architecture.
C. Supprimer les lectures ALS synchrones de la boucle de session (les remplacer par `InstanceState.context`) : large, mais mécanique.
Test de reproduction (patch) : conservé dans le journal de session, non commité tant qu'il échoue.
