# MEI — Revue Fable 5.2 à budget borné

**But :** identifier seulement les défauts structurants avant d'autoriser l'implémentation. Aucun audit général du dépôt, aucune génération de code. Le plan reste PROPOSED. Chaque passe s'arrête avec un livrable court exploitable par un modèle moins coûteux.

## Passe 1 — Architecture / décisions (maximum conseillé : 900 mots de sortie)

> Tu es reviewer d'architecture logiciel (supply-chain, inférence locale, GPU, Android). Lire UNIQUEMENT cette note `docs/roadmap/multi-engine-inference/README.md`, la matrice `WORKBREAKDOWN.md`, les titres et décisions ADR-MEI-02/03/04/07/16. Le delta vault `Plan-MEI-v4.1-amendements-2026-11-14.md` prime les points contraires du v4. **Ne parcours pas le repo, n'écris pas de code.** Donne au plus 5 findings BLOCKER/MAJOR appuyés sur un scénario de panne concret, décision de correction minimaliste et gate concerné. Puis GO/NO-GO P-1/P0/A1. Si aucun problème, conclure, ne brode pas. Réponse <900 mots.

## Passe 2 — Seulement en cas de blocage (maximum conseillé : 600 mots de sortie)

> Analyse UNIQUEMENT l'ADR visé et le finding précis de la passe 1 ; liste solution A/B, arbitrage recommandé, test de validation, ticket et texte d'amendement. Pas de réaudit, pas de code, pas de répétition du contexte. Réponse <600 mots.

Les budgets sont indicatifs, pas une garantie des limites provider. Archiver seulement le verdict et findings non résolus dans l'epic #1148; ne pas conclure que l'exécution est autorisée avant ratification propriétaire.
