---
id: ADR-MEI-13
title: "Provenance, licences et autorité d'installation"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-13 — Provenance, licences et autorité d'installation

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Les licences et les exécutables tiers diffèrent selon projet, plateforme et canal de distribution.

## Décision proposée
Identité SPDX, attribution, provenance, URL exacte, hash, signature de catalogue, consentement serveur et acceptation licence spécifique pour exceptions. Inventaire SBOM/attributs selon faisabilité.

## Alternatives examinées / écartées
Considérer le hash d'un catalogue non signé comme preuve d'éditeur ; cacher les licences.

## Conséquences et risques
Distinguer preuve d'intégrité et signature éditeur, copyleft soumis à arbitrage owner.

## Critères de validation et preuves exigées
Artefact non approuvé refusé, AGPL non activé implicitement, génération de journal d'audit local.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
