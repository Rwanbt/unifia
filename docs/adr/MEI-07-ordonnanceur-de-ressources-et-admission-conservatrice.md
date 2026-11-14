---
id: ADR-MEI-07
title: "Ordonnanceur de ressources et admission conservatrice"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-07 — Ordonnanceur de ressources et admission conservatrice

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Deux moteurs individuellement exécutables peuvent dépasser ensemble VRAM/RAM ; Unifia doit composer avec Voice et agents.

## Décision proposée
Dès P0-10, admission `poids+KV estimé+marge <= budget connu` ; VRAM libre inconnue => une instance gérée. En C1, files d'attente, priorité, leases, backpressure, déchargement gracieux, annulation et admission multi-instance.

## Alternatives examinées / écartées
Lancer sans garde sur ports libres ; tuer l'ancien moteur silencieusement.

## Conséquences et risques
Heuristiques étalonnées et signalement de l'inconnu, jamais d'estimation présentée comme mesure.

## Critères de validation et preuves exigées
Test 8 Go VRAM/16 Go RAM, inconnues, simultanéité, crash OOM, annulation, aucun kill tiers, limites thermiques.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
