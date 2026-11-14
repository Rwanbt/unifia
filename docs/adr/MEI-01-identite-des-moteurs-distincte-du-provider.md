---
id: ADR-MEI-01
title: "Identité des moteurs distincte du provider"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-01 — Identité des moteurs distincte du provider

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Le provider `local-llm` participe aux sessions et à l'autorité de localité ; un fork et une instance LAN ne justifient pas de nouveaux providers.

## Décision proposée
Conserver une façade logique pour les moteurs gérés localement et référencer `engineInstanceID` et `modelArtifactID`. La décision d'egress dépend de la destination effective et de l'instance.

## Alternatives examinées / écartées
Un provider par moteur ; inférer la confiance depuis `providerID` ou localhost.

## Conséquences et risques
Migration sensible pour knowledge/DLP et sessions ; conserver une compatibilité flag-off.

## Critères de validation et preuves exigées
Cas on-device, LAN, proxy loopback vers Internet, remote et destination inconnue; aucune autorisation supplémentaire implicite.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
