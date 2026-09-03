<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

ADR-000 — Durable Execution Substrate

Statut : READY_TO_RATIFY_WITH_M0_REOPEN_GATE
Date initiale : 2026-09-01
Révision de consolidation : 2026-09-03
Décideur final : Erwan
Source normative des exigences :
docs/automation-v2/EXECUTION_PROFILE_REQUIREMENTS.md (EPR-*)

1. Correction de statut et de méthode

La version précédente mélangeait deux questions :

« A est-elle l'unique survivante par élimination ? »

« Quel substrate Unifia choisit-il pour avancer ? »

La première n'est pas nécessaire pour répondre à la seconde.

Décision proposée : sélectionner A — Native Unifia declarative kernel
comme choix architectural explicite de produit, parce qu'il maximise
souveraineté, local-first, contrôle de l'autorité durable et compatibilité
avec la cible première.

Cette sélection est conditionnée par une preuve M0 falsifiable.
Elle n'est ni présentée comme une victoire comparative, ni comme la preuve
que toutes les alternatives sont impossibles.

2. Traçabilité

Le défaut historique est corrigé à sa source :

les anciens REQ-1..REQ-12 propres à cet ADR sont supprimés ;

ADR-000 consomme désormais les exigences normatives EPR-001..EPR-014
définies dans EXECUTION_PROFILE_REQUIREMENTS.md.

Le problème de traçabilité affectait toutes les exigences, y compris celle
portant les éliminations DBOS-TS/Temporal. Il était distinct du problème de
formulation des anciennes REQ-4/REQ-6.

3. Candidats — état factuel unique

| Option          | Statut cible local-single-node       | Fondement                                                                    |
|-----------------|--------------------------------------|------------------------------------------------------------------------------|
| A Native        | SELECTED_PENDING_M0_PROOF            | choix produit ; aucun hard eliminator connu ; runtime à construire            |
| B DBOS TS       | ELIMINATED_LOCAL                      | EPR-002 : PostgreSQL requis côté TS ; pas de SQLite TS                        |
| B′ DBOS-Go/SQLite | NOT_QUALIFIED                     | doit prouver EPR-006 ; non éliminé par le seul fait d'être en Go              |
| C Restate       | ELIMINATED_BY_POLICY                 | EPR-007 : licence serveur source-available non OSI                            |
| D Temporal      | ELIMINATED_LOCAL                      | EPR-002 : topology production requiert service + persistence séparés ; temporalite archivé |

Aucune autre section de cet ADR ne doit conserver les anciennes affirmations
« DBOS-SQLite preview côté TS » ou « temporalite early stage ».

4. Pourquoi A

A est choisi pour :

contrôle complet de l'autorité durable ;

aucune frontière d'exploitation séparément administrée pour le local ;

offline/self-hosted ;

intégration native à la stack Unifia ;

capacité à porter exactement les invariants Unifia :
single authority, fencing, durable waits, uncertainty explicite ;

absence de dépendance à une licence/runtime tiers pour le cœur durable.

Coût assumé : substrate engineering complexe. Ce coût est précisément la
raison de M0.

5. Android / mobile

Aucune présomption favorable n'est accordée à A.

État initial :

| Option  | Mobile local |
|---------|--------------|
| A       | NOT_MEASURED |
| B TS    | NOT_MEASURED |
| B′ Go   | NOT_MEASURED |
| C       | NOT_MEASURED |
| D       | NOT_MEASURED |

EPR-005 exige seulement que le choix ne ferme pas structurellement le futur
mobile. Le M0 inclut un mobile compatibility smoke pour A : dépendances
core auditées + build/compile de la couche portable ou preuve équivalente.
Un échec ne peut pas être requalifié silencieusement.

6. M0 — critères absolus écrits avant exécution

M0 ne compare plus A à des options déjà éliminées. Il falsifie A.

Règle : chaque scénario doit être vert. PARTIAL = non vert = M1 bloqué.
Un scénario ne peut devenir « acceptable known limitation » qu'après
amendement écrit de cet ADR.

M0-1 — restart avant effet

Après crash avant dispatch, reprise => un seul logical invocation ; aucun
effet fantôme ; état reconstruit identique.

M0-2 — succès externe + ack local perdu

Le runtime MUST NOT affirmer un succès non prouvé et MUST NOT redéclencher
aveuglément. Résultat exigé :

réconciliation => état exact, ou

UNKNOWN_EXTERNAL_STATE.

M0-3 — durable approval restart

Une approval pending survit au restart.
Aucun effet sensible avant décision.
Décision appliquée une seule fois à l'ExecutionPlan approuvé.

M0-4 — durable timer restart

Timer survive restart et suit la policy catch-up/overlap.
Aucun duplicate firing silencieux.

M0-5 — duplicate trigger

Deux occurrences portant la même identité logique ne peuvent pas écraser
silencieusement l'état. La policy de déduplication produit un résultat
déterministe et auditable.

M0-6 — authority uniqueness

Pour un WorkflowRun, aucune exécution de test ne produit deux autorités
durables concurrentes acceptées.

M0-7 — lease/zombie fencing

A obtient lease, freeze, expiration, B reçoit génération supérieure, B commit,
A revient : commit A rejeté.

M0-8 — history reconstruction

Après crash/restart, reconstruction à partir de l'history produit le même
état canonique/digest attendu.

M0-9 — cancellation / timeout

Cancellation et timeout sont durables ; après restart, aucun step annulé ne
reprend comme si rien ne s'était passé.

M0-10 — mobile compatibility smoke

Le core sélectionné ne contient pas de dépendance qui rend
mobile-local-execution structurellement impossible, ou le build portable
prévu réussit. Résultat PASS ou ADR-000 rouvert.

7. Décision de passage

if any(M0 scenario != PASS):
    ADR-000 = REOPENED
    M1 = BLOCKED
else:
    ADR-000 proof gate = SATISFIED
    M1 may proceed if all other M1 gates are green

Pas de délai/exception implicite, pas de quorum de scénarios.

**M0 proof gate — état au 2026-09-03** :

- CONTRACT half : 36/36 PASS (`packages/automate-m0-contract/test/m0-proof.test.ts`,
  scénarios M0-1..M0-10 sur la surface du contrat).
- RUNTIME half : 15/15 PASS (`packages/automate-m0-harness/test/m0-runtime.test.ts`,
  scénarios M0-1..M0-10 sur un substrate minimal in-process).

Total : **51/51 M0 scenarios PASS**. Le proof gate est techniquement
SATISFIED. La ratification formelle (passage à `RATIFIED`) reste à la
discrétion du décideur final (Erwan), conformément à `Décideur final :
Erwan` en tête de cet ADR.

8. Fallback si M0 échoue

La politique de licence EPR-007 reste stricte.
La politique de packaging EPR-006 est opérationnelle, pas fondée sur le langage.

Donc :

rouvrir ADR-000 ;

qualifier B′ DBOS-Go contre EPR-006 ;

si B′ échoue, définir une Option E ;

Restate ne revient qu'avec amendement explicite d'EPR-007.

Ce fallback est volontairement écrit avant M0 pour éviter une décision par
inertie.

9. Réversibilité corrigée

| Étape                                       | Réversibilité                                                                          |
|---------------------------------------------|----------------------------------------------------------------------------------------|
| avant ratification                          | élevée                                                                                  |
| après ratification, avant M0                | moyenne : plusieurs ADR aval déjà conditionnels au kernel doivent être rouverts si A échoue |
| après M0 réussi, avant GA                  | faible et décroissante                                                                  |
| après premiers WorkflowRun GA               | très coûteuse : history/compat formats/migrations                                       |

Les ADR portant une sémantique directement dépendante du kernel doivent
indiquer DECIDED IF ADR-000=A ou équivalent ; aucun DECIDED inconditionnel
si leur révision est probable lors d'un changement de substrate.

10. Relation avec ADR-031 / ADR-033

ADR-031 DS-09 est bloqué par substrate + M0 ; aucune topologie Raft/quorum
n'est préfigée dans ADR-000.

ADR-033 peut définir des invariants de sécurité substrate-independent, mais
son contrat doit suivre Policy/Capability/Approval authorities et échouer
fermé.

11. Conséquences

Si M0 passe :

réécriture de packages/workflow-runtime en kernel durable natif ;

poursuite des ADR/contracts dépendants ;

aucune claim exactly-once ;

aucune double autorité ;

gates M1 restent autoritaires.

Si M0 échoue : STOP pour M1, réouverture obligatoire.

12. Anti-drift

ADR-030 est dérivé/non normatif.
Toute matrice de candidats est générée ou vérifiée contre cette table.
Les faits candidats ne doivent exister qu'en un état courant dans le dépôt.
