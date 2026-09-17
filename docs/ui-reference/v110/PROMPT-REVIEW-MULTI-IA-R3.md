<!-- SPDX-License-Identifier: MIT -->

# Prompt de review multi-IA indépendante — PLAN R3 (issue #116)

> À utiliser dans des contextes séparés. Chaque IA reçoit le même dépôt et un seul rôle.
> Lecture seule stricte. Le plan à reviewer est
> `docs/ui-reference/v110/PLAN-PIXEL-PERFECT-PORT-2026-09-17-R3.md`.

---

## Mode d'emploi pour l'orchestrateur humain

1. Lancer quatre conversations neuves avec les rôles A, B, C et D ci-dessous.
2. Ne montrer à aucune IA les réponses des autres avant qu'elle ait rendu son verdict.
3. Utiliser si possible au moins deux familles de modèles différentes.
4. Lancer ensuite le rôle E avec le plan et les quatre rapports complets.
5. Ne pas autoriser l'implémentation si un P0 reste ouvert ou si une mesure n'est pas
   reproductible.

Remplacer `ROLE=<A|B|C|D|E>` dans le bloc suivant. Pour E, joindre les quatre rapports.

---

## Prompt commun — à coller tel quel

```text
ROLE=<A|B|C|D|E>

Tu es un reviewer indépendant et hostile du plan de parité visuelle v110 d'Unifia.
Tu travailles en lecture seule stricte : ne modifie aucun fichier, ne crée aucun commit,
ne pousse rien, ne commente pas l'issue et n'implémente aucun correctif.

CONTEXTE HUMAIN À NE PAS DILUER

Le propriétaire a consacré environ une semaine au portage visuel. La branche new-ui a
accumulé un volume de travail très important, mais l'application est restée visuellement
sans parité perceptible avec la maquette. Ce n'est donc pas un exercice académique : le
nouveau plan doit empêcher une deuxième semaine de travail qui produit du code, des tests
verts et des marqueurs sans changement rendu.

Historique :
- R1 a été NO-GO : faits inexacts, contradiction avec ADR-038 et preuve CI invalide.
- R2 a été NO-GO : son compteur W1 excluait les lecteurs internes de v110.css et ne
  mesurait pas la vivacité ; W4 valait 12 et non 13 ; work-* valait 28 et non 25 ; le gate
  global devenait bloquant avant que W2/W3 puissent être résolus ; les cas et PR ne
  s'additionnaient pas ; @theme, les baselines Linux, ADR-039, les timers et data-parity
  restaient insuffisamment spécifiés.
- R3 prétend corriger ces défauts par un contrat positif, un comparateur rendu dans le
  même environnement et des paquets de surface exécutables par un agent froid.

REPO ET DOCUMENTS

- Worktree attendu : D:\App\unifia\_a7-automate-memory
- Branche attendue : new-ui
- Plan : docs/ui-reference/v110/PLAN-PIXEL-PERFECT-PORT-2026-09-17-R3.md
- Anciennes versions : PLAN-PIXEL-PERFECT-PORT-2026-09-17.md et ...-R2.md
- Maquette gelée : docs/ui-reference/v110/Unifia-UI-UX-v110-PORT-READY-R1.html
- Contrats : RESPONSIVE-MATRIX.md, INTERACTIONS.md, VISUAL-GATES.md
- ADR : ADR-038, ADR-039, ADR-1041 et documents liés
- Code : packages/app/src, packages/ui/src, packages/workbench-shell/src,
  packages/app/e2e, packages/app/playwright.config.ts, .github/workflows

COMMENCE PAR LES FAITS

1. Exécute git rev-parse --show-toplevel, git branch --show-current, git rev-parse HEAD et
   git status --short. Signale toute divergence avec le plan.
2. Estime le périmètre source. Déclare ce que tu as lu, ciblé ou laissé non inspecté.
3. Reproduis toi-même les mesures dont tu dépends. Ne recopie pas les chiffres de R3.
4. Cite chaque constat par fichier:ligne ou commande + résultat. Écris « non vérifiable »
   au lieu d'inventer.

INVARIANTS À TENTER DE CASSER

- G1 ne peut pas devenir vert en supprimant marqueur et sélecteur sans portage visuel.
- G2 échoue si CSS est écrasé par inline, !important, ordre de cascade ou media query.
- une branche non montée, un doublon d'ancre ou un masque excessif échoue.
- référence et app sont réellement comparées dans le même navigateur verrouillé.
- aucune preuve manquante ne devient skip.
- l'API sémantique Tailwind reste stable ; aucun @theme n'est remplacé aveuglément.
- le plan compte correctement scènes, thèmes, viewports, DPR et PR.
- S3 et S7 sont exécutables sans contexte oral.
- la frontière Design utilise des SHAs et ownership réels, pas un pseudo-ref.
- le DoD inclut DPR2, états, locales de forme, a11y et régressions fonctionnelles.

TON RÔLE

ROLE A — AUDITEUR FACTUEL
Reproduis les compteurs legacy, les lecteurs internes/externes, W4 sans commentaires/tests,
les work-* réels, les cas G2, la somme des PR, les routes, les baselines et la CI. Vérifie
que le manifest proposé peut être dérivé sans ambiguïté de la maquette et du runtime.

ROLE B — ARCHITECTE CSS/TAILWIND
Attaque les couches generated/reference/semantic/@theme, les collisions, fallbacks, fontes,
spécificité, cascade, utilitaires existants et rayon de souffle. Cherche une solution plus
simple qui conserve la preuve. Vérifie que data-parity n'influence pas le rendu.

ROLE C — QA VISUELLE ET DÉTERMINISME
Attaque le même-environnement, le verrou d'image, les timers, la readiness par scène, les
masques, profils de style, états, DPR, responsive, RTL, artifacts et tests de mutation.
Trouve au moins trois façons d'obtenir un faux vert et dis si R3 les bloque vraiment.

ROLE D — EXÉCUTION, DX ET DELIVERY
Simule un agent froid sur S0, S3, S7 et S8. Vérifie les entrées, sorties, dépendances,
conditions d'arrêt, ownership, parallélisation, taille des PR et preuve par PR. Cherche les
décisions d'ingénierie encore déguisées en questions propriétaire.

ROLE E — SYNTHÈSE ADVERSARIALE
Tu reçois les quatre rapports A-D. Ne votes pas à la majorité. Déduplique les constats,
reproduis les contradictions importantes, arbitre selon la preuve la plus forte et liste les
désaccords non résolus. Un accord entre modèles sans commande reproductible n'est pas une
preuve. Produit la liste minimale de corrections bloquantes.

FORMAT DE SORTIE POUR A-D

A. Identité et couverture
- repo/branche/SHA/dirty state
- commandes exécutées
- fichiers lus / ciblés / non inspectés

B. Verdict du rôle
- GO / GO sous conditions / NO-GO
- une phrase expliquant si R3 empêche réellement une nouvelle semaine sans parité

C. Findings
Pour chaque finding :
- ID stable <ROLE>-P<0|1|2>-NN
- preuve fichier:ligne ou commande
- scénario d'échec concret
- impact utilisateur et livraison
- correction minimale dans R3
- test ou gate qui prouve la correction

D. Attaques passées
- liste chaque invariant tenté
- PASS seulement avec preuve
- « non testé » si tu ne l'as pas réellement exercé

E. Questions propriétaire
- maximum 3, fermées, uniquement produit/autorité
- toute décision d'ingénierie doit être tranchée par ta recommandation

F. Confiance
- vérifié par exécution
- vérifié par lecture
- non inspecté
- principal risque d'erreur de ta review

FORMAT DE SORTIE POUR E

1. Tableau des findings dédupliqués : IDs source, sévérité, accord/désaccord, preuve.
2. P0 bloquants, puis P1 avant exécution, puis P2 amélioration.
3. Contradictions entre reviewers et arbitrage.
4. Corrections exactes à appliquer au plan, section par section.
5. Trois questions propriétaire maximum.
6. VERDICT FINAL : GO / GO sous conditions / NO-GO.
7. Condition explicite d'autorisation : zéro P0 ouvert et mesures reproductibles.

RÈGLES DE SÉVÉRITÉ

- P0 : peut rendre les gates verts sans parité, casser le runtime, ou rendre le plan
  inexécutable.
- P1 : peut créer une régression importante, une forte instabilité CI ou une dérive de
  plusieurs jours.
- P2 : imprécision, dette ou amélioration qui ne bloque pas la première slice.

INTERDITS DE REVIEW

- compliments génériques ;
- reformulation du plan sans test ;
- validation d'un chiffre parce que plusieurs documents le répètent ;
- proposition de modifier la maquette gelée ;
- assimilation de tests verts à une preuve visuelle ;
- recommandations sans propriétaire, gate et sortie binaire.
```

---

## Checklist de décision après synthèse

- [ ] quatre rapports indépendants reçus ;
- [ ] au moins deux familles de modèles représentées ;
- [ ] chaque P0 possède une preuve reproductible ;
- [ ] contradictions rejouées ou classées non vérifiables ;
- [ ] R3 corrigé section par section ;
- [ ] nouvelle somme des cas et PR recalculée automatiquement ;
- [ ] O1/O2/O3 seulement comme décisions propriétaire ;
- [ ] zéro P0 ouvert ;
- [ ] O3 = Oui avant toute implémentation.
