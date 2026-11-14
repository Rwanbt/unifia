---
id: ADR-MEI-12
title: "Moteurs, services et routeurs : types distincts"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-12 — Moteurs, services et routeurs : types distincts

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Ollama, LM Studio, LocalAI, llama-swap et llama.cpp ont des responsabilités et propriétés d'installation différentes.

## Décision proposée
Définir `engine | service | router` et `managed | external-managed | embedded`, adaptateurs HTTP/JNI séparés ; les connexions externes ne confèrent aucun droit de désinstaller le processus.

## Alternatives examinées / écartées
Tout décrire comme un moteur installable.

## Conséquences et risques
UI et contrats plus précis ; conserver support des services existants.

## Critères de validation et preuves exigées
Retirer une connexion Ollama/LAN sans arrêter le service; cycle de vie et secrets limités à propriété Unifia.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
