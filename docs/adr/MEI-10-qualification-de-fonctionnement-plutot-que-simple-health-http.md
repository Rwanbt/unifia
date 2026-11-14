---
id: ADR-MEI-10
title: "Qualification de fonctionnement plutôt que simple health HTTP"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-10 — Qualification de fonctionnement plutôt que simple health HTTP

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Un HTTP 200 ne garantit pas que modèle chargé produit du texte correct ni que GPU est utilisé.

## Décision proposée
Niveaux readiness, load, génération, streaming, tool calling/vision déclarés, télémétrie locale mémoire et débit. Lier `verified` au fingerprint build/modèle/appareil.

## Alternatives examinées / écartées
`status<500` = ready ; croire un log d'offload GPU.

## Conséquences et risques
Coût de test matériel explicite et statut NOT RUN pour preuves absentes.

## Critères de validation et preuves exigées
404 non healthy, réponse vide invalide, tokens corrects, offload vérifié, versions/OS/driver renseignés.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
