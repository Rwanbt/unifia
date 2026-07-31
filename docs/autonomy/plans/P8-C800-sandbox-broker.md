# P8-C800 — Plan détaillé : SandboxBroker multi-backend

**Carte parente :** P8-C800 (Phase 8, DEFERRED → DETAILED)
**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Source :** Plan V3 §20 « SandboxBroker multi-backend »

## Contexte

SandboxBroker unifie les **backends d'isolation** (Native, Docker, WSL2, Lima, Browser profile) derrière un seul port `SandboxPort` (P2-C200f). Le CompositeSandboxPort sélectionne automatiquement le backend selon l'OS.

## Découpage en sous-cartes (8)

- **P8-C800a** : `NativeSandboxPort` (Linux : chroot + UID/GID + namespaces)
- **P8-C800b** : `NativeSandboxPort` (macOS : sandbox-exec profile)
- **P8-C800c** : `NativeSandboxPort` (Windows : Job Objects + restricted token)
- **P8-C800d** : `DockerSandboxPort` (container éphémère `docker run --rm`)
- **P8-C800e** : `WslSandboxPort` (distribution éphémère WSL2)
- **P8-C800f** : `LimaSandboxPort` (VM éphémère Lima sur macOS)
- **P8-C800g** : `CompositeSandboxPort` (auto-sélection selon OS)
- **P8-C800h** : Tests multi-backend (matrix OS × backend)

## Critères de sortie Plan V3 §20

- [ ] 4 backends implémentés
- [ ] CompositeSandboxPort fonctionne
- [ ] Default-deny policy respectée
- [ ] Tests sur 3 OS minimum

## Dépendances

- **P2-C200f** (SandboxPort interface)
- **P3-C300b** (PolicyEngine — chaque sandbox prepare est autorisée)
- **P3-C300i** (AuditRuntime — chaque execution est tracée)

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| Docker non installé sur certains OS | `MEDIUM` | Fallback Native |
| WSL2 lent | `LOW` | Timeout configurable |
| Lima nécessite macOS récent | `LOW` | Fallback Native macOS |

## Estimation

**Total : 2-3 semaines solo**, 1-1.5 semaines équipe 2-3
