# P9-C900 — Plan détaillé : Remote bridges (Slack/Feishu)

**Carte parente :** P9-C900 (Phase 9, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué Phase 3 Security
**Date :** 2026-07-31
**Source :** Plan V3 §21 « Remote bridges contrôlés »

## Contexte

Les **remote bridges** permettent à Unifia d'être piloté depuis Slack/Feishu. Le port `RemoteTransportPort` (P2-C200g) abstrait la couche transport.

## Découpage en sous-cartes (6)

- **P9-C900a** : `SlackRemoteTransport` (Slack Events API + slash commands)
- **P9-C900b** : `FeishuRemoteTransport` (Feishu Event Subscription + bot)
- **P9-C900c** : `RemoteCommand` (parse, validate, authorize)
- **P9-C900d** : `RemoteIdentity` (pairing, jetons scopés, rotation)
- **P9-C900e** : UI approbation (intégration ApprovalBroker)
- **P9-C900f** : Tests d'intégration Slack/Feishu (sandbox)

## Critères de sortie Plan V3 §21

- [ ] 2 bridges (Slack, Feishu) implémentés
- [ ] Pairing sécurisé
- [ ] Jetons scopés et rotation
- [ ] Approbation humaine pour commandes sensibles

## ⚠️ SECURITY-CRITICAL

**Cette phase est SECURITY-CRITICAL** (Plan V3 §21) :
- Remote commands = entrées non-trusted
- Default deny sur remote.receive
- Combinaisons critiques : `remote.receive + terminal.run` BLOQUÉ par défaut
- Demande validation humaine

## Dépendances

- **P2-C200g** (RemoteTransportPort)
- **P3-C300** (Security foundation — bloqué toolchain + validation humaine)
- **P3-C300d** (Transactions/PolicyEngine)

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| Slack/Feishu = surface d'attaque élevée | `HIGH` | Allowlist stricte, jetons scopés |
| Jetons volés | `HIGH` | Rotation automatique, révocation |
| Commandes destructives | `HIGH` | Approval obligatoire |

## Estimation

**Total : 2-3 semaines solo**, 1-1.5 semaines équipe 2-3
