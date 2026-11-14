---
id: ADR-MEI-03
title: "Manifeste déclaratif avec allowlist typée des flags"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-03 — Manifeste déclaratif avec allowlist typée des flags

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Le catalogue est une entrée distante ; des commandes ou flags libres créeraient une capacité d'exécution de code.

## Décision proposée
Manifest strict/versionné, `launchRecipeID` référant à un adaptateur revu. Flags AUTORISÉS ET TYPÉS définis en code de l'adaptateur, le manifeste ne donne que les valeurs. Exécutable issu d'artefact vérifié ; arguments chemin canonicalisés et bornés ; bind loopback imposé ; pas de shell arbitraire.

## Alternatives examinées / écartées
`launch.command` et `args[]` libres ; adaptateurs natifs téléchargés.

## Conséquences et risques
Nouveaux protocoles nécessitent revue et release; nouveaux moteurs HTTP compatibles sont ajoutables par données.

## Critères de validation et preuves exigées
Manifeste signé demandant `--host 0.0.0.0`, `--path C:\`, `--rpc`, `--api-key-file` hors store, `--chat-template-file` ou LoRA externe => refus avant spawn.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
