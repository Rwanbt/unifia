<!-- SPDX-License-Identifier: MIT -->

# Prompt de review indépendante — PLAN R4 (issue #116)

Copier ce prompt avec les trois fichiers suivants :

1. `PLAN-PIXEL-PERFECT-PORT-2026-09-17-R4.md` ;
2. `REVIEW-MULTI-IA-R3-SYNTHESIS-2026-09-17.md` ;
3. `Unifia-UI-UX-v110-PORT-READY-R1.html` ou un accès lecture au dépôt.

Remplacer `ROLE=<A|B|C|D>` pour les quatre reviews indépendantes. Ne lancer le rôle E
qu'après réception des quatre rapports A–D.

---

## Mission

Tu reviews en lecture seule le PLAN R4 de port visuel v110 d'Unifia. Le plan existe parce
qu'une semaine de travail et une branche très volumineuse n'ont produit aucune parité
visuelle perceptible. L'échec précédent venait de faux signaux : marqueurs, CSS, tokens,
compteurs et CI verte sans comparaison rendue entre la maquette et l'application.

Ta mission n'est pas de féliciter le plan. Tu dois chercher comment il pourrait encore :

- consommer plusieurs jours avant le premier gain visible ;
- devenir vert avec une UI différente ;
- masquer une différence statique ou un élément non déclaré ;
- comparer des collections dans le mauvais ordre ;
- produire des preuves non reproductibles ;
- casser fonction, accessibilité, responsive, Tailwind ou runtime réel ;
- être inexécutable par un agent froid.

## Identité attendue

```text
repo      D:\App\unifia\_a7-automate-memory
branch    new-ui
plan      docs/ui-reference/v110/PLAN-PIXEL-PERFECT-PORT-2026-09-17-R4.md
issue     https://github.com/Rwanbt/unifia/issues/116
```

Le SHA du plan n'est pas présumé : reproduis-le. Toute divergence de branche, worktree,
dirty state ou autorité doit être signalée avant l'analyse.

## Règles impératives

1. Lecture seule stricte : aucune modification, aucun commit, aucun push.
2. Commence par :

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short --branch
git worktree list
```

3. Vérifie chaque nombre par une commande ou un parseur adapté. Un `git grep` brut qui
   mélange code, docs, tests et commentaires n'est pas une preuve.
4. Cite `fichier:ligne` et colle le résultat essentiel des commandes.
5. Un finding sans scénario d'échec concret n'est pas bloquant.
6. Un rapport sans accès au repo doit porter le verdict `DOCUMENT-ONLY`, jamais `GO`.
7. Ne recopie pas les findings R3 sans vérifier que R4 ne les a pas déjà fermés.
8. Distingue fait exécuté, observation de code et hypothèse.

## Rôles

### ROLE=A — factualité et contrat

Vérifie : identité Git, hash de la maquette, issue #116, compteurs legacy, manifest,
cardinalités DOM/visibles, `matchBy`, ledger, exemptions, calcul des cas, absence de total
normatif et scan `data-parity`.

Attaques minimales :

- permuter deux pills ;
- cacher un doublon ;
- supprimer marqueur et règle ensemble ;
- conserver une exemption expirée ;
- faire diverger le total généré et un texte de plan.

### ROLE=B — CSS, Tailwind et tokens

Vérifie : extraction après cascade, dark/light, collision de tokens, mapping sémantique,
API Tailwind existante, fallbacks, fontes/licences, profils de styles et ordre de cascade.

Attaques minimales :

- écraser une valeur par inline/`!important` ;
- réordonner les imports ;
- retirer une propriété visible du profil ;
- faire entrer generated tokens et `@theme` en collision ;
- casser un utilitaire sémantique existant.

### ROLE=C — QA visuelle et déterminisme

Vérifie : environnement lock, image digest, seed/clock/timezone/locale/DPR/fontes, serveur
HTTP commun, BrowserContext isolés, timer registry, double capture, budgets locaux, scène
hors ancres, masques, états, pseudo-éléments, responsive, DPR2 et motion séparée.

Attaques minimales :

- changer le seed ou une fonte ;
- introduire un timer tardif ;
- masquer un libellé statique ;
- couvrir un nœud non déclaré ;
- créer une différence uniquement au hover ;
- déplacer parent et enfant en sens opposés ;
- retirer la preuve de référence.

### ROLE=D — exécution autonome et DX

Vérifie en simulation froide P0, P1, S0, S3, S7, S8 et S15. Contrôle les chemins,
commandes, dépendances, branches cibles, limites de PR, artifacts, arrêts, ownership Design,
statuts partiels et promotion finale.

Attaques minimales :

- tenter P1 sans contexte oral ;
- vérifier qu'un pixel visible arrive dans la deuxième PR ;
- laisser S8 sans approbation ;
- viser `work-design` depuis une slice ;
- exécuter G3 à partir d'un checkout froid ;
- distinguer `NON_DESIGN_ONLY` de `FULL_PARITY`.

### ROLE=E — synthèse adversariale

Entrées obligatoires : les quatre rapports A–D. Déduplique, rejoue les contradictions avec
les preuves les plus déterministes, puis classe P0/P1/P2. Un vote majoritaire ne résout pas
un conflit factuel. Refuse le GO si un rôle est `DOCUMENT-ONLY` ou si un P0 reste ouvert.

## Questions auxquelles chaque rôle doit répondre

1. Le pilote P1 peut-il produire une amélioration Home visible dans la deuxième PR ?
2. G1 peut-il devenir vert par suppression ou mauvaise association ?
3. G2 peut-il tolérer un défaut local perceptible ou le cacher par masque ?
4. Le lock invalide-t-il toute divergence runtime pertinente ?
5. Un état interactif, un DPR ou une locale peut-il échapper au calcul ?
6. G3 protège-t-il réellement fonction et accessibilité avec des commandes existantes ?
7. La frontière Design peut-elle créer une fausse déclaration de parité complète ?
8. Un agent froid sait-il exactement quel fichier créer, quelle commande lancer et quel
   artifact produire pour sa slice ?

## Format obligatoire du rapport A–D

```text
A. Identité et couverture
- repo / branche / SHA / dirty state
- commandes exécutées
- fichiers lus, ciblés et non inspectés

B. Verdict
- GO | NO-GO | DOCUMENT-ONLY
- une phrase de cause

C. Findings
- ID, sévérité P0/P1/P2
- preuve reproductible
- scénario d'échec
- impact utilisateur/livraison
- correction minimale
- test ou gate qui prouve la correction
- confiance de 0 à 1

D. Attaques
- résultat de chaque attaque obligatoire : PASS | FAIL | NON TESTÉ

E. Questions propriétaire
- maximum trois, seulement si aucune règle déterministe ne peut trancher

F. Confiance
- vérifié par exécution
- vérifié par lecture
- non inspecté
```

## Format obligatoire du rôle E

- matrice dédupliquée des findings et sources ;
- contradictions et arbitrage par preuve ;
- liste exacte des P0 ouverts ;
- corrections minimales section par section ;
- verdict final `GO` seulement si : quatre rôles repo-access, au moins deux familles de
  modèles, zéro P0 et preuves reproductibles.

Le plan R4 est actuellement **PROPOSÉ**. La review ne doit ni commencer l'implémentation ni
mettre à jour silencieusement les autorités.
