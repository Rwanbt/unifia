---
id: 0007
title: ApprovalBroker
status: PROPOSED
date: 2026-07-31
---

# ADR-0007: ApprovalBroker — workflow d'approbation

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §8.3, §8.7

## Contexte

Unifia doit gérer un **workflow d'approbation** pour les actions sensibles. Quand un agent demande une action qui requiert approbation (PolicyEngine retourne `require-approval`), l'utilisateur doit pouvoir :
- Approuver ou refuser depuis l'UI
- Approuver une fois ou pour toujours
- Voir l'historique des approbations
- Révoquer une approbation

## Décision

Adopter le pattern **ApprovalBroker** comme composant de gouvernance (Plan V3 §5) avec :

```typescript
interface ApprovalBroker {
  request(request: ApprovalRequest): Promise<ApprovalHandle>
  listPending(filter?: ApprovalFilter): Promise<PendingApproval[]>
  decide(approvalId: string, decision: ApprovalDecision): Promise<ApprovalResult>
  listHistory(filter?: ApprovalHistoryFilter): Promise<ApprovalHistoryEntry[]>
  revoke(grantId: string): Promise<void>
}
```

**Types principaux** :
- `ApprovalRequest` : action, context (workspace, user, agent), risk level, proposedAt, expiresAt
- `ApprovalHandle` : approvalId, status (pending/approved/denied/expired)
- `ApprovalDecision` : approve / deny / approve-once
- `PendingApproval` : ApprovalRequest + currentDecision (if any)

**UI Integration** :
- Modal/popup natif (Tauri) avec détails de l'action
- Notification desktop (optionnel)
- Action par défaut : **deny après expiration** (typiquement 5 min)

**Implémentations** :
1. `LocalApprovalBroker` (défaut, stockage local des approbations)
2. `MemoryApprovalBroker` (pour tests)

**Combinaisons critiques** (Plan V3 §15) qui requièrent TOUJOURS approbation :
- `secret.read + network.request`
- `desktop.control + secret.read`
- `remote.receive + terminal.run`
- `package.install + desktop.control`
- `workspace.read[global] + network.request[*]`
- `browser.cookies + network.request[*]`

## Conséquences

### Positives
- ✅ **Transparence** : l'utilisateur voit ce que l'agent veut faire
- ✅ **Audit** : chaque approbation est tracée
- ✅ **Expiration** : pas d'approbation oubliée qui traîne
- ✅ **Révocation** : l'utilisateur peut changer d'avis

### Négatives
- ❌ **UX friction** : trop d'approbations → frustration → contournement
- ❌ **Latence** : l'agent attend la décision (max 5 min par défaut)
- ❌ **Spam** : l'agent peut demander 100 approbations/minute

### Neutres
- ApprovalBroker ne décide pas la policy (c'est PolicyEngine)

## Alternatives considérées

### A. Approbation via Slack/Feishu uniquement
- **Rejeté** : ne marche pas offline, dépendance externe

### B. Pas d'approbation (auto-approve tout)
- **Rejeté** : viole Plan V3 §8.3

### C. Approbation via TOTP / 2FA
- **À reconsidérer** : pour les actions très sensibles, demander 2FA en plus

## Plan d'implémentation

- **Phase 3** : interfaces TypeScript + ApprovalRequest schema
- **Phase 3** : LocalApprovalBroker + UI Tauri modal
- **Phase 7** : UI Shell Unifia intégration
- **Phase 17** : notifications desktop (optionnel)

## Liens

- Plan V3 §5 (Trust and Governance)
- Plan V3 §8.3 (Sécurité avant computer use)
- Plan V3 §15 (Combinaisons critiques)
- ADR-0006 (PolicyEngine) — déclenche ApprovalBroker
- ADR-0008 (SecretStore) — actions sensibles
- ADR-0009 (AuditRuntime) — trace chaque approbation