# P5-C500 — Plan détaillé : Extraction OpenWork server

**Carte parente :** P5-C500 (Phase 5, DEFERRED → DETAILED)
**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Source :** Plan V3 §17 « Extraction OpenWork : serveur, orchestrateur et multi-workspace »

## Contexte

OpenWork upstream a un **serveur headless** avec orchestrateur et multi-workspace. Unifia doit extraire ce serveur en `OpenCodeRuntimeAdapter` (cf. ADR-0001).

## Découpage en sous-cartes (6)

- **P5-C500a** : Cloner OpenWork `different-ai/openwork@2c558bcff` (déjà fait) en lecture seule
- **P5-C500b** : Identifier `apps/server` d'OpenWork (~50 fichiers TS)
- **P5-C500c** : Refactorer `apps/server` en `OpenCodeRuntimeAdapter` (implémentation du port `RuntimeAdapter`)
- **P5-C500d** : Tests conformance (P1-C100c)
- **P5-C500e** : Documentation (mapping OpenWork API → RuntimeAdapter)
- **P5-C500f** : Exclusions `/ee/` strictes (50+ branches, ADR-0012)

## Critères de sortie Plan V3 §17 (Gate A)

- [ ] OpenCodeRuntimeAdapter passe la conformance suite
- [ ] Workbench peut démarrer avec OpenCode (sans UI)
- [ ] Aucun code `/ee/` importé
- [ ] Multi-workspace fonctionnel

## Dépendances

- **P2-C200b** (RuntimeAdapter interface)
- **P1-C100c** (Conformance suite)
- **ADR-0012** (Provenance et exclusion /ee/)

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| OpenWork a des bugs non-fixés | `MEDIUM` | Fixtures + tests intégration |
| Runtime OpenWork trop différent d'Unifia | `HIGH` | Adapter strict, pas de wrapper |
| Code `/ee/` accidentel | `HIGH` | 3 couches de protection (ADR-0012) |

## Estimation

**Total : 2-3 semaines solo**, 1-1.5 semaines équipe 2-3
