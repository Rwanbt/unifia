---
id: ADR-MEI-16
title: "Propriétaire unique des processus natifs par plateforme"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-16 — Propriétaire unique des processus natifs par plateforme

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Le code comporte des voies de spawn concurrentes Bun et Rust; l'arrêt d'un sidecar ne doit pas orpheliner des moteurs.

## Décision proposée
Desktop: propriétaire exclusif Rust/Tauri pour spawn/stop/reap, process groups/pidfd Linux et Job Objects Windows quand applicables; Bun client du contrôle versionné. Android: propriétaire runtime hôte Rust/Kotlin. `experiments.localEngines` off => legacy identique. Prévoir P-1.7 cartographie des spawners et état owner/refs/locks.

## Alternatives examinées / écartées
Laisser les deux propriétaires piloter simultanément; Bun unique propriétaire sur toutes les plateformes.

## Conséquences et risques
P-1.7 et ratification owner avant A1-03; migrations progressives, signatures de processus contre PID recycling.

## Critères de validation et preuves exigées
Tuer Bun pendant génération puis relancer => aucun doublon/orphelin; PID recyclé => jamais kill process tiers; sidecar Android restauré à partir du registre durable.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
