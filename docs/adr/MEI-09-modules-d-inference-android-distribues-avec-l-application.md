---
id: ADR-MEI-09
title: "Modules d'inférence Android distribués avec l'application"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-09 — Modules d'inférence Android distribués avec l'application

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Android/Play/ABI/JNI ne permettent pas de traiter tout binaire Linux téléchargé comme module mobile sûr.

## Décision proposée
Moteurs natifs embarqués ou distribués via variante/module conforme au canal ; téléchargements dynamiques pour poids/modèles et données, non pour bibliothèques natives arbitraires. POC JNI Prism dès P-1.

## Alternatives examinées / écartées
Télécharger puis `dlopen` toute `.so` depuis le magasin.

## Conséquences et risques
État des modules clair : intégré / nécessite mise à jour / incompatible / inconnu.

## Critères de validation et preuves exigées
Build arm64 physique, JNI et dépendances natives, reprise et sécurité du runtime après kill du sidecar.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
