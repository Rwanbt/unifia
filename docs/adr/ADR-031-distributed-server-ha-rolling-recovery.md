<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

ADR-031 — Distributed Server HA / Rolling Upgrade / Recovery

Statut : CHANGES_REQUIRED_BEFORE_RATIFICATION
Date : 2026-09-02
Révision : 2026-09-03
Dépendances : ADR-000, ADR-008, ADR-016, ADR-018,
EXECUTION_PROFILE_REQUIREMENTS.md

Status

La version antérieure était DECIDED. Ce statut est retiré.

DS-09 n'est pas substrate-independent : la localisation, la réplication,
l'élection et le quorum de l'autorité durable font partie du substrate.
Aucun contrat Raft/quorum n'est figé avant ADR-000 + M0.

Aucun contrat DS-09/10/11 ne doit être ajouté à WorkspaceConfig.

Portée

local-single-node : hors scope, HA non.

server-single-node : un nœud, HA non.

server-cluster : futur profil multi-nœuds ; c'est le seul profil visé par
la HA distribuée.

DS-09 — invariants seulement, mécanisme différé

Le contrat stable avant choix de topologie est comportemental :

une seule autorité durable valide pour un run à un instant logique ;

aucune partition ne peut produire deux auteurs de side effects valides ;

tout changement d'autorité porte un leader/control-plane epoch ou
équivalent substrate, vérifié à la frontière d'effet ;

les workers conservent leurs fencing tokens de lease (ADR-008) ;

l'ancien leader et les workers zombies sont rejetés après failover ;

la membership du cluster est versionnée et auditable ;

perte de quorum/autorité => fail closed, jamais promotion heuristique.

Non-décisions

ADR-031 ne décide pas encore :

Raft vs autre mécanisme ;

taille du quorum ;

voter/learner topology ;

heartbeat/election tuning ;

stockage du log répliqué ;

active-active vs leader/follower pour le control plane.

Ces décisions appartiennent à un ADR post-M0 spécifique au substrate.

Interdictions

pas de quorumPct configurable ;

pas de paire 2-nœuds avec promotion automatique sans witness/fencing externe ;

pas de confusion entre worker heartbeat et peer-consensus heartbeat ;

pas de claim « active-active control plane » si l'écriture reste leader-based.

DS-10 — Rolling upgrade

ADR-018 reste la source normative du pattern :

expand -> compatible rollout -> migrate -> contract.

Le futur contrat d'opérateur doit séparer :

batchSize

maxUnavailable

maxSurge

canaryPercent

canaryDwellMs

critères de santé + minimum sample size

Il ne doit pas réutiliser maxOldWorkers comme taille de batch.

Invariants

canary >=1 worker quand le cluster n'est pas vide ;

le canary ne peut pas être validé sans un nombre minimum de requêtes/events ;

worker rollout et control-plane rollout sont deux opérations distinctes ;

un rollback automatique n'est permis que tant que le migration commit
point n'a pas rendu les écritures incompatibles avec N ;

leases des workers N sont drainées avant arrêt, conformément à ADR-018 ;

tests N↔N+1 obligatoires sur protocol, IR, history et connectors.

DS-11 — Recovery

Trois classes sont séparées :

NodeRecovery

Perte d'un worker/nœud sans perte de l'autorité durable.

QuorumOrAuthorityRecovery

Perte de l'autorité/quorum ; fail closed et intervention selon le substrate.

SiteDisasterRecovery

Perte d'un failure domain complet. Ne peut être revendiquée que si snapshot,
history et clés nécessaires existent dans un failure domain indépendant.

RPO / RTO

Toute policy doit déclarer explicitement :

targetRpoMs

targetRtoMs

source de snapshot

source de history

preuve de restore testée

Un simple replayRateLimit = 1000 events/s n'est pas un RTO.

Snapshot

Un snapshot n'est jamais autorisé à « perdre les events entre snapshot et
crash » silencieusement.

snapshot + history complète depuis le snapshot => recovery valide ;

history manquante/corrompue => les runs affectés deviennent
UNKNOWN_EXTERNAL_STATE ou recovery échoue explicitement ;

aucune reprise en running/succeeded sur un état incomplet.

Failure model

Le consensus standard visé est crash/partition/fail-stop, pas Byzantine.
Un nœud compromis est traité par identité, policy, signing, audit et
revocation ; aucune garantie BFT n'est revendiquée.

Configuration

La configuration de déploiement future appartient à des objets opérateur,
par exemple :

ClusterRuntimeConfig

DeploymentUpgradePolicy

DisasterRecoveryPolicy

Elle n'appartient pas au WorkspaceConfig.

Gate avant ratification

ADR-031 ne peut repasser DECIDED qu'après :

ADR-000 ratifié ;

M0 entièrement vert ;

substrate cluster design disponible ;

tests écrits pour partition asymétrique, leader freeze, old-leader zombie,
lost quorum, simultaneous restart, membership change, leader transfer,
N/N+1, rollback avant/après migration commit point, corrupt snapshot,
missing history, site loss ;

aucune contradiction avec ADR-008/016/018.

Conséquence immédiate

Ne pas livrer DS-09/10/11 contracts depuis la version précédente.
packages/contracts/src/server.ts reste limité aux DS-01..08 existants.
