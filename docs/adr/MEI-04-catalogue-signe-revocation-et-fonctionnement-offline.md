---
id: ADR-MEI-04
title: "Catalogue signé, révocation et fonctionnement offline"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-04 — Catalogue signé, révocation et fonctionnement offline

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Catalogue statique peut suffire mais signature, anti-rollback, expiration et rotation sont critiques avant téléchargement/exécution.

## Décision proposée
Utiliser un schéma établi choisi en P-1.6 (minisign ou TUF/sigstore) ; clé publique épinglée ; racine offline et plan de rotation/compromission rédigés en P0-04b. Expiration interdit installation et mise à jour, pas l'usage d'un artefact installé non révoqué. Révocation connue en cache bloque le lancement.

## Alternatives examinées / écartées
JSON sans signature ; faire de la validité réseau une condition de lancement des moteurs déjà installés.

## Conséquences et risques
Gouvernance de clés propriétaire uniquement ; cache offline cohérent et registre monotone.

## Critères de validation et preuves exigées
Signature invalide, version signée plus ancienne, expiration hors ligne, révocation connue, rotation clé, test horloge avancée.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
