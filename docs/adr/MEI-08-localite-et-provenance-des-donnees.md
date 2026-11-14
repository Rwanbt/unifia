---
id: ADR-MEI-08
title: "Localité et provenance des données"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-08 — Localité et provenance des données

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Un serveur local peut être un proxy qui relaie les requêtes vers Internet.

## Décision proposée
Distinguer deployment/transport/upstream réel/ownership/trust/egress à la requête ; destination inconnue = distante/non fiable. Conserver guards DLP/knowledge et politique permissions.

## Alternatives examinées / écartées
Assumer que loopback est privé ; tout `local-llm` bénéficie des permissions du local.

## Conséquences et risques
Protection contre fuite de notes, clés API et tool egress au moment du changement de moteur.

## Critères de validation et preuves exigées
Loopback proxy vers remote ne peut pas envoyer du contenu privé silencieusement ; régression `provider/locality.ts`.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
