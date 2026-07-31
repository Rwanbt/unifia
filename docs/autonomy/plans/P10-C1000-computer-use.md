# P10-C1000 — Plan détaillé : Browser + Computer Use contrôlés

**Carte parente :** P10-C1000 (Phase 10, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué Phase 3 Security + Phase 8 Sandbox
**Date :** 2026-07-31
**Source :** Plan V3 §22 « Browser et Computer Use contrôlés »

## Contexte

**Computer use** est la fonctionnalité la plus sensible d'Unifia : l'agent peut **piloter** le desktop (clics, frappes, screenshots). Elle est **désactivée par défaut** (Plan V3 §8.7) et nécessite :
- ApprovalBroker
- PolicyEngine
- TaintTracker
- Screenshot redaction
- Allowlist d'applications
- Bouton d'arrêt d'urgence
- Tests d'injection visuelle
- Replay protection

## Découpage en sous-cartes (8)

- **P10-C1000a** : `BrowserSandboxPort` (Chromium profile jetable)
- **P10-C1000b** : `DesktopAutomationBroker` (cross-platform, derrière Sandbox)
- **P10-C1000c** : Screenshot capture + redaction automatique (PII, secrets)
- **P10-C1000d** : Allowlist d'applications (par workspace, par user)
- **P10-C1000e** : Bouton d'arrêt d'urgence (UI Tauri + keyboard shortcut)
- **P10-C1000f** : Tests d'injection visuelle (prompt injection via screenshots)
- **P10-C1000g** : Replay protection (events horodatés, signature)
- **P10-C1000h** : Documentation utilisateur (comment activer, dangers)

## Critères de sortie Plan V3 §22

- [ ] Browser profile jetable
- [ ] Computer use broker
- [ ] Screenshot redaction
- [ ] Allowlist
- [ ] Bouton d'urgence
- [ ] Tests d'injection
- [ ] Replay protection
- [ ] Documentation dangers

## ⚠️ EXTRÊMEMENT SECURITY-CRITICAL

**Cette phase est la plus sensible d'Unifia** (Plan V3 §22) :
- Computer use = **vecteur d'attaque principal** (un agent compromis peut faire n'importe quoi)
- Combinaisons critiques : `desktop.control + secret.read` BLOQUÉ par défaut
- **Doublé par screenshot redaction** : les secrets affichés à l'écran sont masqués
- **Demande validation humaine + audit externe** avant activation

## Dépendances

- **P3-C300** (Security) — bloqué toolchain + validation humaine
- **P8-C800** (SandboxBroker) — pour isoler le computer use
- **P9-C900** (Remote bridges) — pour piloter depuis Slack/Feishu

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| Agent compromis fait des dégâts | `CRITICAL` | Bouton d'urgence, allowlist, kill switch |
| Prompt injection via screenshot | `HIGH` | Redaction, validation visuelle |
| Vol de secrets affichés à l'écran | `CRITICAL` | Screenshot redaction, taint tracking |
| Fuite d'actions via network | `HIGH` | Default deny, audit |

## Estimation

**Total : 4-6 semaines solo**, 2-3 semaines équipe 2-3 (Plan V3 §22)

## Note

**Cette phase NE DOIT PAS être activée par défaut.** Unifia v1.0 doit être livré SANS computer use, et l'activer uniquement après validation humaine + audit de sécurité.
