<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-031 — Distributed Server HA + Rolling Upgrade + Cluster Recovery (DS-09/10/11)

> **Statut** : DECIDED
> **Date** : 2026-09-02
> **Source** : POST-M3-TRACKS-PLAN §2.2 (DS-09 RED, DS-10 RED,
>   DS-11 RED), plan V2.3.1 §208-209, ADR-008 (scheduler/worker
>   time authority, DECIDED), ADR-018 (rolling upgrade
>   compatibility, DECIDED), ADR-020 (ownership/deployment scope,
>   DECIDED), ADR-024 (extension runtime, DECIDED),
>   `@unifia/contracts/src/server.ts` (DS-01..08 livrés R2).
> **Cible** : profiles `server-single-node` et `server-cluster` du
>   plan §187. **PAS** la cible première `local-single-node` (qui est
>   par définition single-node).

## Status

DECIDED. ADR d'**impact architectural** (plan §197). Couvert par les
contrats `@unifia/contracts/src/server.ts` (DS-01..08) et étendu ici
pour DS-09/10/11. **N'est PAS** bloqué par ADR-000 (les implémentations
runtime dépendent du substrate mais les contrats sont indépendants).

## Contexte

DS-09 (HA), DS-10 (rolling upgrade) et DS-11 (cluster recovery) sont
les 3 dernières cartes RED du track Distributed Server. Elles
définissent comment un cluster de workers (potentiellement des
dizaines ou des centaines de nœuds) maintient la continuité de
service en présence de :

- **Pannes matérielles** (DS-09 HA) : un worker meurt, le cluster
  redistribue ses leases.
- **Mises à jour logicielles** (DS-10 rolling) : un sous-ensemble
  du cluster est en v1 pendant qu'un autre est en v2.
- **Disasters** (DS-11 recovery) : un data center entier est
  perdu, le cluster reconstruit depuis la history archive.

Les contrats DS-01..08 (WorkerRegistry, Lease, FencingToken,
WorkQueue, FairScheduler, Quota, RateLimiter, Budget) sont en
place. DS-09/10/11 les étendent avec la dimension multi-nœud.

## Decision

### DS-09 — High Availability (HAConfig)

**Pas de HA** pour la cible première `local-single-node` (par
définition). HA activé pour `server-single-node` (active-passive)
et `server-cluster` (active-active avec leader election).

**Schémas supportés** :

- **`single`** : pas de réplication, c'est le profile
  `local-single-node`. Aucune configuration requise.
- **`active-passive`** : un leader + un standby, promotion manuelle
  ou automatique sur heartbeat loss. Convient à `server-single-node`
  avec 2 instances.
- **`active-active`** : N nœuds avec leader election distribuée
  (Raft). Convient à `server-cluster`.

**Contrat** :

```typescript
export const HAReplicationSchema = z.enum(["none", "active-passive", "active-active"])
export const HALeaderElectionSchema = z.enum(["raft", "simple"])
export const HAQuorumSchema = z.number().int().min(1).max(99)
  .describe("Percentage of nodes required to acknowledge a write (e.g. 51 for majority)")

export const HAConfigSchema = z.object({
  replication: HAReplicationSchema,
  leaderElection: HALeaderElectionSchema.default("raft"),
  quorumPct: HAQuorumSchema.default(51),
  /** Heartbeat interval in ms. 1000 minimum (lower bound for Raft). */
  heartbeatMs: z.number().int().min(1000).max(60_000).default(5000),
  /** Election timeout in ms. Must be > heartbeatMs. */
  electionTimeoutMs: z.number().int().min(2_000).max(120_000).default(15_000),
})
```

**Invariants** :

- `replication = "active-active"` ⇒ `quorumPct >= 51` (majorité stricte
  pour éviter le split-brain). `quorumPct = 50` est rejeté.
- `electionTimeoutMs >= 2 * heartbeatMs` (sinon élections trop
  fréquentes).
- Pour `local-single-node`, `replication = "none"` est le seul choix
  accepté.

### DS-10 — Rolling Upgrade (UpgradeStrategy)

**Stratégie** : canary progressif avec rollback automatique sur
erreur.

**Contrat** :

```typescript
export const UpgradeStrategySchema = z.object({
  /** Percentage of workers updated first (canary). 1-50. */
  canaryPercent: z.number().int().min(1).max(50).default(10),
  /** Wait time (ms) between canary batch and full rollout. */
  canaryDwellMs: z.number().int().min(60_000).max(3_600_000).default(600_000),
  /** Error rate above which rollback fires. Float 0.0-1.0. */
  rollbackOnErrorRate: z.number().min(0).max(1).default(0.05),
  /** Window (ms) for error rate measurement. */
  errorWindowMs: z.number().int().min(60_000).max(3_600_000).default(300_000),
  /** Max concurrent old-version workers during the transition. */
  maxOldWorkers: z.number().int().min(1).default(10),
})
```

**Sémantique** :

1. Les workers sont partitionnés en `canaryPercent` canariens
   (déployés en premier avec la nouvelle version) et le reste.
2. Après `canaryDwellMs`, on lit l'error rate sur la fenêtre
   `errorWindowMs`. Si `> rollbackOnErrorRate` → rollback.
3. Sinon, déploiement progressif sur les anciens workers par
   batch de `maxOldWorkers`.
4. À tout moment, le cluster peut servir du trafic (capacité
   réduite pendant le canary).

**Invariants** :

- `canaryPercent < 50` (le canary est minoritaire).
- Pendant le canary, le profile `active-active` maintient
  l'élection leader sur les anciens workers (le canary est
  passif).
- La `HAConfig.replication` du **v2** doit être compatible avec
  celle du **v1** pendant toute la transition (sinon, refus
  avec `UpgradeError.code = "INCOMPATIBLE_HA"`).

### DS-11 — Cluster Recovery (RecoveryPolicy)

**Stratégie** : replay depuis la history archive, avec rate
limiting pour éviter de saturer le réseau.

**Contrat** :

```typescript
export const RecoveryStrategySchema = z.enum(["replay-history", "rebuild-from-snapshot", "operator-driven"])
export const RecoveryPolicySchema = z.object({
  strategy: RecoveryStrategySchema.default("replay-history"),
  /** For replay-history: max recovery time before the operator is paged. */
  maxRecoveryMs: z.number().int().min(60_000).max(86_400_000).default(3_600_000),
  /** For replay-history: max events replayed per second. */
  replayRateLimit: z.number().int().min(1).max(100_000).default(1_000),
  /** For rebuild-from-snapshot: how often snapshots are taken. */
  snapshotIntervalMs: z.number().int().min(3_600_000).max(604_800_000).default(86_400_000),
  /** Whether to alert the operator on incomplete recovery. */
  pageOnIncomplete: z.boolean().default(true),
})
```

**Sémantique** :

1. **Detection** : un nœud manque 3 heartbeats consécutifs
   (`heartbeatMs * 3`).
2. **Quorum check** : on vérifie qu'on a encore quorum
   (`HAConfig.quorumPct`). Sinon → `RecoveryError.code =
   "LOST_QUORUM"`, page opérateur, pas de recovery automatique.
3. **Recovery** :
   - `replay-history` (default) : on demande à la history archive
     (ADR-016) les events depuis le dernier snapshot du nœud perdu.
   - `rebuild-from-snapshot` : on charge le snapshot le plus récent
     et on applique les events depuis.
   - `operator-driven` : aucune action automatique, l'opérateur est
   pagé immédiatement.
4. **Rate limit** : le replay est rate-limité à `replayRateLimit`
   events/s pour éviter de congestionner le réseau.
5. **Timeout** : si `maxRecoveryMs` est dépassé → `RecoveryError.
   code = "RECOVERY_TIMEOUT"`, l'opérateur est pagé.

**Invariants** :

- `replay-history` est le default parce qu'il garantit la
  consistency (events = ground truth).
- `rebuild-from-snapshot` est plus rapide mais peut perdre les
  events entre le snapshot et le crash.
- `operator-driven` est obligatoire pour les profiles
  réglementés (EN-02 audit log, EN-03 compliance SOC2).

## Consequences

- **DS-09/10/11** peuvent être implémentés en runtime dès qu'ADR-000
  est ratifié. Les contrats sont indépendants du substrate.
- **HAConfig** + **UpgradeStrategy** + **RecoveryPolicy** sont
  ajoutés à `WorkspaceConfig` (à postuler dans
  `@unifia/contracts/src/workspace-config.ts`, livrable post-M3).
- **Cible première `local-single-node` n'est PAS affectée** :
  `HAConfig.replication = "none"`, pas de rolling upgrade, pas
  de recovery multi-nœud.
- **Profile `server-single-node` cible `active-passive`** avec
  Raft-like leader election (mais single-leader, pas de quorum
  distribué).
- **Profile `server-cluster` cible `active-active` + Raft** avec
  rolling upgrade canary 10% + replay-history recovery.
- **Threat Model** : nouveau surface d'attaque (network split,
  byzantine leader). Ajout dans THREAT_MODEL §1 (TM-DS-01..04).

## Gating

- **DS-09/10/11 runtime** : bloqué par ADR-000 (substrate).
- **DS-09/10/11 contracts** : peut être livré maintenant
  (extension de `server.ts`).
- **Cert gate** : nouvelle section `gates.yaml §16
  distributed_server_ha` à ajouter quand le runtime est prêt.

## Liens

- `packages/contracts/src/server.ts` (DS-01..08, 28 tests PASS)
- `docs/adr/ADR-008-scheduler-worker-time-authority.md` (DECIDED)
- `docs/adr/ADR-018-rolling-upgrade-compatibility.md` (DECIDED)
- `docs/adr/ADR-020-ownership-deployment-scope.md` (DECIDED)
- `docs/adr/ADR-024-extension-runtime-trust-isolation.md` (DECIDED)
- `docs/adr/ADR-016-history-retention-archival.md` (DECIDED, pour
  DS-11 replay)
- Plan V2.3.1 §208-209 (DS cards), §186-188 (cert profiles)
- `THREAT_MODEL.md §1` (single authority + Raft)
- `EXECUTION_PROFILE_REQUIREMENTS.md §1.8` (no UNSUPPORTED)

## Décisions de fond (rappel)

1. **DS-09** : 3 schémas (`none` / `active-passive` / `active-active`),
   Raft leader election, `quorumPct >= 51` pour `active-active`.
2. **DS-10** : canary 10% + dwell 10min + rollback auto si
   `errorRate > 5%` sur fenêtre 5min.
3. **DS-11** : replay-history default, rate-limited à 1000 events/s,
   timeout 1h, page opérateur si dépassé.
4. **Cible première `local-single-node`** : aucune de ces 3
   cartes ne s'applique (par définition single-node).
