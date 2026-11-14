---
id: ADR-MEI-02
title: "Plan de contrôle Bun, exécuteurs natifs"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-02 — Plan de contrôle Bun, exécuteurs natifs

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Le sidecar Bun existe sur desktop et Android mais ne doit pas devenir propriétaire concurrent des moteurs.

## Décision proposée
Bun gère catalogue, autorisations, résolution et état de contrôle versionné ; la propriété des processus est définie par ADR-MEI-16, côté Rust/Tauri desktop et hôte Rust/Kotlin Android.

## Alternatives examinées / écartées
Tout gérer dans Bun ; réimplémenter toute la politique dans chaque plateforme.

## Conséquences et risques
Contrat exécuteur versionné avec reprise durable, conformance commune, aucun double writer.

## Critères de validation et preuves exigées
Kill/restart du sidecar Bun desktop et Android, replay idempotent de start/stop/status, aucune instance orpheline ou dupliquée.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
