---
id: ADR-MEI-05
title: "Installation transactionnelle sans scripts arbitraires"
status: PROPOSED
date: 2026-11-14
program: multi-engine-inference
source: vault-v4-plus-v4.1
---

# ADR-MEI-05 — Installation transactionnelle sans scripts arbitraires

> **PROPOSÉ — non ratifié.** Une PR de documentation ne vaut ni acceptation ni autorisation d'implémentation. Référence : [epic #1148](https://github.com/Rwanbt/unifia/issues/1148), [source et amendements](https://github.com/Rwanbt/obsidian-dev-brain/blob/master/projects/unifia/references/Plan-MEI-v4.1-amendements-2026-11-14.md). En cas de conflit avec décision propriétaire/ADR déjà ACCEPTED, ouvrir un arbitrage plutôt que modifier implicitement la règle.

## Contexte
Une installation scriptée peut modifier le système hors du périmètre maîtrisable par Unifia.

## Décision proposée
Archives/binaries vérifiés, wheels/venv isolés/pinnés après revue, containers digest-pin optionnels ; connexion `external-managed` pour runtimes déjà installés ; aucun `curl | sh` ou PowerShell arbitraire. Écriture staging+journal+rename et rollback borné.

## Alternatives examinées / écartées
Script générique avec promesse de désinstallation parfaite ; Docker obligatoire.

## Conséquences et risques
Certains moteurs connectables seulement ; priorité à la chaîne d'approvisionnement.

## Critères de validation et preuves exigées
Hash faux, archive path traversal, interruption à chaque transition, reprise Range redirections autorisées, suppression sans effets sur services tiers.

## Gouvernance
Statut `PROPOSED`, owner review requise. Dépendance : gate P-1 (P-1.2 / P-1.6), tests et implémentation uniquement sur issues autorisées. Les violations de sécurité restent bloquantes même si une documentation suggère une facilité.
