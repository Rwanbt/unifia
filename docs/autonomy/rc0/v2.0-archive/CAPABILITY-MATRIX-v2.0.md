# UNIFIA v2.0 — Capability / wiring matrix

> Snapshot d'observation : `new-ui@2c13b7d76d0fdbec33af3952825e6bf84e930df5`. RB00 revalide tout avant exécution.

Cette matrice ne juge pas la qualité du code isolé. Elle répond à une seule question : **la capacité est-elle réellement livrée de bout en bout depuis un root produit ?**

| Surface / domaine | État observé | Déjà réel | Restant avant production | Lots v2.0 |
|---|---|---|---|---|
| Shell / Home | ADVANCED | Navigation, Home interactif, inspecteurs/contextes majeurs réalignés | certification pixel/responsive/a11y, vérité de tous les contrôles | RB05, UI03, UI04, UI13-15 |
| Chat / Session | BLOCKER_PRESENT | session/chat principaux fonctionnels | deadlock après Stop sur génération pendue (#77), certification reprise/retry | CR01, CR10, UI05 |
| Code | PARTIAL-ADVANCED | éditeur, LSP de base, diagnostics/blame avancés, terminal réel | requalifier #96 : code lens, inline AI et tout gap restant ; tabs terminal/context actions | CR08, FX05, FX06, UI06 |
| Work / Team | PARTIAL | données réelles, board/runs/views | mutation canonique statut tâche (#86), Run/Approve/Generate update, policies/undo | CR06, FX01, UI07 |
| Design | ADVANCED / CERTIFICATION | document canonique workspace, canvas natif, vectoriel, layers, comments, import legacy | i18n #99/#103, visual/a11y final, vérifier chaque contrôle SOON | CR09, UI08, FX00 |
| Automate Studio | ADVANCED UI / PARTIAL RUNTIME | canvas node-based, library, run bar, draft canonique, NativeWorkflowRuntimePort | `workflow.run` step-up, exécution nodes+edges réelle, autorité durable, scheduler, config nodes, Test/fixture/→Work | CR03-05, FX02-04, UI09 |
| Browser | MAJOR WORKSTREAM | surface v110 et navigation native partielle | service/session/tab canonique, visible page = automated page, agent control, observation receipts, takeover, network/SSRF, secrets, downloads, isolation, E2E | BR00-BR10, UI12 |
| Memory | ADVANCED UI / PARTIAL GOVERNANCE | vault, folders/DnD, autosave, actions, graph | wikilink rename #93, brancher memory-governance si in-scope | CR07, PW04, UI10 |
| Settings / Account | PARTIAL | nombreux dialogs et MCP persistence livrés | convertir/retirer tous les SOON sans backend, routing IA réel, compte/sécurité selon scope | FX07-09, UI11 |
| Voice | DIVERGED ACTIVE CAMPAIGN | implémentation v2.2 substantielle sur branche `voice` | réconciliation sur base fraîche, gates #117, CI bloquante, qualification physique Windows/Android et plateformes applicables | VO00-VO05, QA11 |
| Browser runtime package | NOT SHIPPED | moteur testé isolément | consumer via Browser service canonique | BR01+, PW06 |
| Capability runtime | NOT SHIPPED | package présent/testé | autorité réellement utilisée sur chemins produit sélectionnés | PW01 |
| Secret broker | NOT SHIPPED | moteur présent/testé | brancher aux disclosure/tool/browser paths ou exclure explicitement | PW02 |
| Observability package | NOT SHIPPED | schema/runtime présents | consumer + producteurs des domaines manquants | PW03, FX10 |
| Memory governance | NOT SHIPPED | package présent/testé | brancher à Memory ou classifier park/delete | PW04 |
| Workbench orchestrator | NOT SHIPPED | moteur présent/testé | brancher aux parcours Work/Team voulus ou classifier | PW05 |
| Sandbox / Computer-use safety | NOT SHIPPED | moteurs présents/testés | Browser/agent integration avec authority et sécurité | PW07, BR05-BR09 |
| Artifact stack | NOT SHIPPED | artifact-store/studio/document-packs/generative-ui présents | brancher aux surfaces Design/Work exports voulues ou classifier | PW08 |
| Scheduler / media-runtime | NOT SHIPPED | moteurs présents/testés | Automate schedule/Voice-media selon scope | PW09, FX03 |
| Remote bridge / desktop-runtime | NOT SHIPPED | moteurs présents/testés | remote/device flows ou exclusion explicite | PW10 |
| CI / Release | NOT CERTIFIED CURRENT HEAD | main/dev protégées et outillage important | current new-ui n'a pas de preuve PR/CI pour le HEAD observé ; corriger flakes/checks/security/deps puis RC immuable | RB03, QA00-12, RL00-08 |

## Lecture obligatoire

- `ADVANCED` ne veut pas dire production-certifié : il reste les gates du RC.
- `NOT SHIPPED` ne veut pas dire « mauvais » : le package peut être excellent isolément mais n'est pas encore dans une chaîne produit livrée.
- Toute promotion d'un `NOT SHIPPED` vers `DONE` exige la chaîne : **authority → implementation → transport → shipped consumer → evidence**.
- Toute fonctionnalité visible v110 doit finir soit `REAL`, soit `EXPLICITLY_DISABLED/UNAVAILABLE` avec décision de scope, soit `REMOVED`. Un faux contrôle n'est jamais une option.
