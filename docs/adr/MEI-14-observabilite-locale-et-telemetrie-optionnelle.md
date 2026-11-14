---
id: ADR-MEI-14
title: "Observabilité locale et télémétrie optionnelle"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-14 — Observabilité locale et télémétrie optionnelle

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Le benchmark et les erreurs doivent être diagnostiquables sans envoyer du contenu utilisateur à un service.

## Décision proposée
Événements locaux sans prompts ni secrets, export explicite nettoyé ; télémétrie agrégée absente par défaut et consentement si ajoutée ultérieurement.

## Alternatives examinées / écartées
Collecter les prompts/ressources et envoyer des métriques automatiquement.

## Conséquences et risques
Mesures comparables avec traces bornées au SHA, contraintes de confidentialité.

## Critères de validation et preuves exigées
Aucun secret ni contenu de prompt dans les logs standards; export vérifié; statut NOT RUN quand mesure absente.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
