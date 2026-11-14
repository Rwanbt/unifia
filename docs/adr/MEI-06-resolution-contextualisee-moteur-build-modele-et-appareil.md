---
id: ADR-MEI-06
title: "Résolution contextualisée moteur, build, modèle et appareil"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-06 — Résolution contextualisée moteur, build, modèle et appareil

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Le format et une version minimale ne suffisent pas à prédire chargement, qualité ni accélération GPU.

## Décision proposée
Résoudre `ModelArtifact × EngineBuild × backend × DeviceProfile × capabilities`. États compatible/limité/expérimental/incompatible/inconnu avec raisons, puis probes réels et fingerprints de build.

## Alternatives examinées / écartées
Table statique `format -> engine` ; supposer la compatibilité à partir d'un tag source.

## Conséquences et risques
Complexité des métadonnées mais règles composables ; modèles catalogue SHA obligatoire, import manuel non vérifié.

## Critères de validation et preuves exigées
Bonsai PQ2_0 fork seulement; Q2_0 upstream avec version requise; même quantification avec layout différent; inconnus non présentés comme READY.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
