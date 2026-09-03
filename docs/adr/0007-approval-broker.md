---
id: 0007
title: ApprovalBroker
status: READY_FOR_REVIEW  # V2 draft (post review v1.1 2026-09-03)
status_v1: PROPOSED       # legacy 2026-07-31 V1, à archiver
date: 2026-07-31
date_v2: 2026-09-03
---

# ADR-0007: ApprovalBroker V2 — workflow d'approbation

**Statut :** `READY_FOR_REVIEW` (V2 draft, post review v1.1 2026-09-03)
**Date initiale :** 2026-07-31 (V1 PROPOSED, conservé pour archive)
**Date V2 :** 2026-09-03 (intègre les invariants pack gelé + ADR-033 + ADR-009)
**Décideurs :** Erwan (signature finale), Mavis (rédaction)
**Source :** Plan V3 §5/§8.3/§8.7, pack gelé §34-§35, review v1.1

> **Cette V2 NE REMPLACE PAS** la V1 par un overwrite silencieux.
> La V1 est archivée en bas de fichier pour traçabilité.

## Contexte

Unifia doit gérer un **workflow d'approbation** pour les actions
sensibles. Quand un agent demande une action qui requiert
approbation (PolicyAuthority retourne `require-approval`),
l'utilisateur doit pouvoir :

- Approuver ou refuser depuis l'UI
- Approuver une fois (reusable grants strictement bornés)
- Voir l'historique des approbations
- Révoquer une approbation

**V1 gaps identifiés en review v1.1** (2026-09-03) :

1. Pas de binding explicite à un **ExecutionPlan immutable + canonical
   digest** (ADR-033 l'exige)
2. Pas de séparation explicite **Policy Authority / Approval Authority**
   (l'API `evaluate()` est ambiguë)
3. Pas de **durabilité** au restart du kernel
4. **"Approve forever"** non borné → danger
5. Pas d'**expiration / revocation** explicite

## Décision V2

Adopter le pattern **ApprovalBroker V2** avec invariants stricts
(pack gelé §25-§28) :

### API conceptuelle

```typescript
interface ApprovalBrokerV2 {
  request(req: ApprovalRequestV2): Promise<ApprovalHandleV2>
  resolve(
    approvalId: ApprovalId,
    decision: "APPROVED" | "DENIED",
    actor: Principal,             // OBLIGATOIRE
  ): Promise<ApprovalOutcomeV2>
  cancel(approvalId: ApprovalId, actor: Principal): Promise<void>
  inspect(approvalId: ApprovalId): Promise<ApprovalRequestV2>
  listPending(filter?: ApprovalFilter): Promise<ApprovalRequestV2[]>
  listHistory(filter?: ApprovalFilter): Promise<ApprovalRequestV2[]>
  revokeGrant(grantId: string, actor: Principal): Promise<void>
}
```

**Note** : pas de `evaluate()` (séparation Policy/Approval). Pas de
`approve-once / approve-forever` non borné. L'API est **strictement
minimale** et substrate-neutral.

### Types principaux

```typescript
type ApprovalRequestV2 = {
  approvalId: ApprovalId                    // deterministe
  workflowRunId: WorkflowRunId
  logicalInvocationId?: LogicalInvocationId
  executionPlanDigest: string                // BINDING to immutable plan
  principal: Principal
  ownershipScope: OwnershipScope             // org + workspace
  deploymentScope: DeploymentScope
  capabilityRefs: CapabilityRef[]            // what the plan uses
  resourceScope: ResourceScope               // what resources
  policyDecisionRef: string                  // reference to Policy Authority
  policyVersion: string                      // version of policy
  createdAtEpochMs: number
  expiresAtEpochMs: number                   // fail-closed past
  state: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"
}

type ApprovalOutcomeV2 = {
  approvalId: ApprovalId
  state: ApprovalState
  actor?: Principal
  resolvedAtEpochMs?: number
  reason?: string
}

type ApprovalState = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"
```

### Invariants OBLIGATOIRES (per pack gelé §26)

1. **`pending approval survives restart`** : l'authority est durable
2. **`single effective resolution`** : un approval est résolu UNE
   fois. Deux appels sur le même `approvalId` sont idempotents
   (même outcome) ou closed (erreur)
3. **`resolve idempotent`** : rejouer la même décision = même résultat
4. **`actor mandatory`** : pas de résolution sans Principal
5. **`expiry fail-closed`** : `PENDING` + `expiresAtEpochMs < now` =
   `EXPIRED` (jamais exécuté)
6. **`no widening`** : un reusable grant ne peut pas étendre sa
   scope (principal, scope, capability, resource, policy version)
   sans nouvelle approval
7. **`approval bound to immutable execution-plan digest`** : la
   résolution vérifie que `executionPlanDigest` matche le plan
   courant
8. **`changed plan` → `APPROVAL_STALE`** : si le plan a changé
   entre `request` et `resolve`, l'approval devient STALE et
   requiert une nouvelle demande
9. **`revocation explicit`** : `revokeGrant` annule un reusable
   grant ; la prochaine demande repart de zéro
10. **`history auditable`** : chaque action est loggée append-only
11. **`no ID reuse after restart`** : un `approvalId` ne peut pas
    être réémis sur un approval antérieur
12. **`workflow/LLM cannot self-approve`** : le `principal.id` ne peut
    pas être l'agent qui demande l'action

### Séparation Policy Authority / Approval Authority

| Composant | Responsabilité |
|---|---|
| **Policy Authority** (ADR-009) | Détermine `allow / deny / require-approval` de manière déterministe, versionnée |
| **Approval Broker V2** | Matérialise et résout la décision humaine, ne réévalue PAS la policy |

L'API n'expose **plus** `evaluate()` (qui était ambiguë en V1).
La séparation est conceptuelle ET technique.

### Anti-patterns interdits

- ❌ "Approve forever" non borné (V1 l'autorisait, V2 l'interdit)
- ❌ `evaluate()` qui réévalue la policy
- ❌ Reuse d'`approvalId` après cancel/expiry
- ❌ `actor.id == workflow.principalId` (self-approve)
- ❌ Resolution sans `executionPlanDigest` match
- ❌ Widening implicite du scope d'un reusable grant

## Conséquences

### Positives
- ✅ **Transparence** : l'utilisateur voit le plan immutable
  (`executionPlanDigest` = hash canonique)
- ✅ **Audit complet** : chaque action loggée, replay possible
- ✅ **Expiration** : `expiresAtEpochMs` est un hard deadline
- ✅ **Révocation** : `revokeGrant` annule un reusable grant
- ✅ **TOCTOU prevented** : digest binding détecte le stale
- ✅ **Self-approve prevented** : actor ≠ workflow principal

### Négatives
- ❌ **Plus de friction UX** : pas d'approve-forever, chaque
  action sensible demande explicitement
- ❌ **Plus de code** : binding digest, scope checks, etc.

### Neutres
- Approval Broker V2 ne décide pas la policy
- Approval Broker V2 ne trigger pas l'exécution ; c'est le runtime
  qui consulte l'outcome avant de dispatcher

## Tests négatifs OBLIGATOIRES (per pack gelé §35)

Avant que ADR-0007 puisse être `DECIDED`, les tests négatifs suivants
doivent PASS :

1. **expired approval cannot execute** : `now > expiresAtEpochMs`
   → `EXPIRED`, runtime refuse d'exécuter
2. **different actor/scope cannot reuse approval** : un autre
   principal ne peut pas resolve un approval
3. **resource widening rejected** : un reusable grant ne peut pas
   couvrir plus de ressources que l'approval initiale
4. **changed execution-plan digest rejected** : `STALE` si le
   plan a changé
5. **already resolved approval cannot mutate** : second resolve
   = idempotent ou closed (pas de re-apply silencieux)
6. **cancelled approval cannot execute** : `CANCELLED` → runtime
   refuse
7. **unknown approval denied** : `approvalId` inconnu → `DENIED`
8. **restart preserves pending request** : crash + reopen → la
   même `PENDING` approval est lisible
9. **workflow/LLM cannot self-approve** : actor check
10. **no ID reuse after restart** : nouveau `approvalId` ne peut
    pas être l'ancien
11. **replayable history** : `listHistory` retourne l'audit complet
12. **revocation blocks new requests** : un grant révoqué ne peut
    pas être réutilisé

## Plan d'implémentation

- **Phase 1 (cette session)** : draft V2 dans ce fichier, `READY_FOR_REVIEW`
- **Phase 2** : implémentation `LocalApprovalBrokerV2` (M0 harness
  déjà partielle dans `native-sqlite.ts`)
- **Phase 3** : tests négatifs dans `test/approval-v2.test.ts`
- **Phase 4** : review par Erwan, passage à `DECIDED`
- **Phase 5** : ADR-033 peut alors être `CHANGES_REQUIRED` → re-préparé
  avec negative contract tests PASS

## Alternatives considérées

### A. Garder la V1 (PROPOSED)
- **Rejeté** : V1 a des trous architecturaux (pas de digest binding,
  approve-forever, etc.)

### B. Approval via TOTP / 2FA
- **À reconsidérer** : pour les actions TRÈS sensibles, 2FA en plus
  de l'approval broker

### C. Approval via Slack/Feishu externe
- **Rejeté** : ne marche pas offline, dépendance externe au
  critical path

### D. Pas d'approbation (auto-approve tout)
- **Rejeté** : viole Plan V3 §8.3, ADR-033 l'exige

## Liens

- `docs/adr/0009-audit-runtime.md` — trace chaque approval
- `docs/adr/ADR-009-policy-authority.md` — Policy Authority
- `docs/adr/ADR-024-extension-runtime-trust-isolation.md` — Capability
- `docs/adr/ADR-033-untrusted-code-shell-security.md` — exige ce contrat
- `docs/automation-v2/m0/M0_BLOCKED.md` §2 — méthodologie gaps

---

# V1 ARCHIVÉE (2026-07-31, `PROPOSED`)

> Conservée pour traçabilité. NE PLUS UTILISER. Voir V2 ci-dessus.

**Statut V1 :** `PROPOSED` (legacy)

V1 exposait l'API :
```typescript
interface ApprovalBroker {
  request(request: ApprovalRequest): Promise<ApprovalHandle>
  listPending(filter?: ApprovalFilter): Promise<PendingApproval[]>
  decide(approvalId: string, decision: ApprovalDecision): Promise<ApprovalResult>
  listHistory(filter?: ApprovalHistoryFilter): Promise<ApprovalHistoryEntry[]>
  revoke(grantId: string): Promise<void>
}
```

avec `ApprovalDecision = approve / deny / approve-once` (le
"approve-once" n'était pas borné). Pas de binding digest. Pas
d'actor mandatory. Pas de durabilité au restart.

V1 gaps (post review v1.1 2026-09-03) :
1. Pas de binding ExecutionPlan immutable + canonical digest
2. Pas de séparation explicite Policy / Approval
3. Pas de durabilité au restart
4. "Approve forever" non borné
5. Pas d'expiration / revocation explicite

**V2 ci-dessus adresse tous ces gaps.**
