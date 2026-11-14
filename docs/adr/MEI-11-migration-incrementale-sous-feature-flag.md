---
id: ADR-MEI-11
title: "Migration incrémentale sous feature flag"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-11 — Migration incrémentale sous feature flag

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Il existe plusieurs chemins legacy desktop/mobile + owner/refs, téléchargements et UI; une migration big-bang casse les utilisateurs.

## Décision proposée
Caractériser les comportements actuels ; flag off conserve binaire/ports/model picker/Voice ; adapter legacy, migration state/versionnée et rollback. Éliminer les doubles writers seulement après conformance.

## Alternatives examinées / écartées
Ajouter un manager parallèle non relié ; supprimer immédiatement le legacy.

## Conséquences et risques
Dette de transition documentée avec échéance; anciennes installations adoptées sans perte.

## Critères de validation et preuves exigées
Tests flag-on/off, conversations/modèles intacts, aucune réinstallation implicite ou migration irréversible.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
