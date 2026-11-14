---
id: ADR-MEI-15
title: "Gouvernance des mises à jour et révocations"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-15 — Gouvernance des mises à jour et révocations

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Une nouvelle release/fork peut régresser ; les installations doivent être récupérables hors ligne.

## Décision proposée
Versionner les artefacts, conserver version saine, canal stable manuel, beta/nightly opt-in ; priorité révocation connue, rollback atomique de sélection et redémarrage mesuré à part.

## Alternatives examinées / écartées
Auto update silencieux ; rollback garanti en <2s avec chargement modèle.

## Conséquences et risques
Quota/GC, audit et publication sous autorité du propriétaire.

## Critères de validation et preuves exigées
Coupure réseau et crash durant update, version précédente intacte; aucune release/tag sans owner.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
