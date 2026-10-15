<!-- SPDX-License-Identifier: MIT -->
# UNIFIA RC-1 — Contrat directeur d'exécution autonome

**Type :** contrat opérationnel du `/goal`, pas une nouvelle source de décisions produit.
**Dépôt :** `Rwanbt/unifia` — https://github.com/Rwanbt/unifia
**Cible de travail :** `dev` ; **epic/file canonique :** #581 ; **gouvernance des branches :** #597.
**Date de rédaction :** 2026-10-15. **Rafraîchir depuis GitHub avant toute exécution.**

## 0. Mission, périmètre, résultat attendu

Conduire, de manière autonome et sans interruption inutile, toutes les tâches **autorisées** et **réellement faisables** de la campagne RC-1, jusqu'à une branche `dev` pouvant être déclarée production-ready **sur preuves reproductibles liées à un SHA immuable**. Exécuter du travail concret : audit ciblé, reproduction, correctif minimal, test de non-régression, PR, analyse de CI, réparation, prochaine tâche. Ne pas transformer le goal en production de rapports sans correctifs.

Cette mission n'autorise **ni** fusion de PR, **ni** push direct sur les trois branches permanentes, **ni** tag/signature/publication, **ni** promotion `dev → main`. La décision finale de release appartient exclusivement au propriétaire (D9). Les PR restent en brouillon tant que les vérifications ne sont pas complètes ; prêtes pour revue lorsqu'elles le sont, mais non fusionnées par l'agent.

**Périmètre RC-1 :** rendre parfaitement opérationnelles les fonctions déjà intégrées et annoncées actives ; sécuriser et certifier les flux livrés. Ne pas créer de fonctionnalités hors périmètre pour satisfaire un ancien backlog ou « tout câbler » sans décision.

## 1. Démarrage obligatoire et autorité

Lire **intégralement, dans cet ordre**, depuis un `dev` fraîchement récupéré :
1. `CLAUDE.md`
2. `AGENTS.md`
3. `docs/production/EXECUTION-STATE.md`

Puis relire les décisions `docs/autonomy/rc0/DECISIONS.md`, ADR ratifiés pertinents, l'epic **#581** (surtout **Immediate execution order**), **#597**, issues de travail, PR, actions et rapports. Également :
- `docs/production/RC1-SCOPE.md`
- `docs/production/CAPABILITY-MATRIX.md`
- `docs/production/GAP-REGISTER.md`
- `docs/production/E2E-SKIP-REGISTER.md`
- `docs/production/CONTROLS-GREYED-RC1.md`
- `scripts/package-wiring.json`
- `.github/pull_request_template.md`
- tout `AGENTS.md` imbriqué correspondant aux fichiers touchés.

**Hiérarchie :** décisions les plus récentes du propriétaire > ADR ratifiés > dossier global v1.5.4 pour la cible ultime > v2.2/#581 pour l'ordre et le périmètre RC-1 > faits GitHub pour l'état actuel. Les vieux plans sont historiques. Les tickets GP **#599–#650**, `post-rc1` et Browser UI train 2 ne sont **pas** des tâches de RC-1 sans nouvelle autorisation explicite.

Ne pas utiliser un ancien SHA, une ancienne mention « CI green », la clôture d'une issue ou un package testé comme preuve qu'un flux de production est atteint aujourd'hui. Vérifier les faits depuis GitHub.

## 2. Branches, isolation et droits

Branches permanentes : `main` (production), `dev` (intégration), `dev_auto` (agents planifiés et tickets `lane:auto`). Vérifier `main ⊂ dev ⊂ dev_auto` par merge-base / compare commits à l'ouverture et à chaque jalon important ; comparer des bases correctes, ne jamais confondre `dev` et `dev_auto`.

Quand les branches divergent : recenser les commits uniques, la PR de synchronisation et les propriétaires ; **ne rien réinitialiser, forcer ou supprimer**. Ne pas bloquer les tâches indépendantes. Préparer/revoir une PR de synchronisation si explicitement autorisé, sans la fusionner. Conserver l'historique d'ascendance par commits de fusion (pas squash des synchronisations).

Pour chaque lot : partir du **head courant** de `dev` dans un **worktree isolé**, une branche `fix/<issue>-<motif>` ou `docs/<issue>-<motif>`, diff **≤400 lignes modifiées** sauf autorisation explicite. Une issue par changement cohérent ; éviter le chevauchement des PR, utiliser la PR existante si elle couvre déjà le bug. Le travail `lane:auto` respecte la voie `dev_auto` ; il ne sert pas de raccourci pour un lot de sécurité ou de politique.

Toute modification `.github/**`, toute évolution sensible de politique d'approbation/autorité, CR03 ou P0 demande les règles de revue/validation du propriétaire. **Aucune fusion par cet agent, même en cas de CI verte.** Ne jamais toucher Antigravity ni arrêter des processus n'appartenant pas à la session.

## 3. Décisions RC-1 à ne pas réouvrir

- Browser UI : `DEFERRED_HIDDEN` (D2) ; fondations de train suivant suivies par #118/#279/#554. Pas un gate bloquant release 1 si correctement caché.
- Voice bornée : `REQUIRED` (D3). **Retour propriétaire 15/10 : Voice fonctionne sur les derniers builds Android.** Protéger ce comportement, obtenir la correspondance build/SHA et compléter les preuves ; ne pas reconstruire l'architecture et ne pas confondre preuve Android et certification Windows.
- Windows, Linux, Android : `REQUIRED` (D5). macOS/iOS/Web-PWA explicitement hors RC-1.
- Parité visuelle considérée atteinte (D6) : uniquement régressions vérifiables et tests de non-régression, pas de remaquettage général.
- Work/Kanban réellement fonctionnel `REQUIRED` (D7) ; #580.
- `home.glance` conservé ; `code.diff` desktop conservé ; workspace tabs retirées du périmètre ; `code.diff` compact/mobile après release 1 ; Code Lens/Inline AI hors RC-1 ; split Chat/sessions hors RC-1.
- Contrôles non intégrés : grisés/visibles/non cliquables, sans promesse « bientôt » et sans effet simulé ; suivi post-RC1 #675–#682. Actions Work restent requises.
- RL03–RL07 et promotion, signatures de production, tags/publication réservés au propriétaire (D9).

Catégories : `REQUIRED`, `DEFERRED_HIDDEN`, `DISABLED_VISIBLE`, `NOT_IN_RC1`. Classe de périmètre **distincte** du statut de livraison `IMPLEMENTED/INTEGRATED/TESTED/E2E_CERTIFIED/GA_READY`.

## 4. Boucle autonome non bloquante

### 4.1. Modèle d'états

`TODO`, `READY`, `IN_PROGRESS`, `PR_DRAFT`, `CI_RUNNING`, `CI_FAILED`, `CI_VERIFIED`, `NEEDS_OWNER`, `PHYSICAL_TEST_REQUIRED`, `BLOCKED_EXTERNAL`, `SUPERSEDED`, `DONE`.

- `CI_VERIFIED` : résultat terminal réussi au **head SHA exact** de la PR, pas une qualification du produit après fusion.
- `DONE` : issue résolue sur code effectivement intégré et preuve au point d'entrée distribué, ou disposition formellement ratifiée applicable ; ne jamais la déduire de `PR_DRAFT`.
- Les échecs, skipped, timeouts et infra inconnues ne sont jamais `PASS`.

### 4.2. Ordonnanceur

À chaque itération : (1) récupérer l'état `dev` et #581 ; (2) inspecter issues, travaux des autres agents, branches, PR et CI ; (3) réévaluer le graphe de dépendances ; (4) sélectionner le plus petit lot **READY** à impact RC-1, non dupliqué et non chevauchant ; (5) reproduire, corriger, tester, PR ; (6) lire les résultats exacts ; (7) checkpoint ; (8) passer au lot indépendant suivant.

**Capacité de départ : au plus 2 lots/PR actifs indépendants**, ajuster à 1 si risque de conflits, limites CI ou sécurité. Ne jamais lancer des modifications concurrentes sur la même autorité/fichier. Aucun enchaînement fictif de PR empilées sur des branches non fusionnées. Si une PR attend la CI ou une décision, chercher un lot indépendant autorisé ; revenir à la PR dès qu'un résultat est disponible.

Respecter en premier l'ordre de #581 **tel qu'actuellement ratifié**, en tenant compte des lots déjà clos et des dépendances ; la priorité P0 technique permet de préparer les remédiations sécurité/release sans contourner les décisions de périmètre ou de fusion.

### 4.3. Politique anti-boucle

- Avant un fix : résumer en **deux lignes** cause racine + pourquoi le correctif fonctionne. Si inconnu, diagnostiquer sans coder.
- Échec de test : lire logs et traces, puis isoler cause ; pas d'essais arbitraires.
- Après **3 tentatives infructueuses sur le même problème**, arrêter **ce lot seulement**, enregistrer les essais/observations et 2–3 options ; reprendre une autre tâche READY.
- Pas d'augmentation de timeout, suppression de test, `expect` affaibli ou `skip` de convenance.
- Rechercher dans l'ENSEMBLE du dépôt les occurrences similaires après correctif.
- Ne pas réduire l'objectif global à la dernière issue ou PR traitée.

### 4.4. Limites d'environnement

CI lente → enregistrer run ID/SHA et continuer ailleurs. Test physique Windows/Android/GPU impossible → produire protocole, test statique et preuves disponibles, `PHYSICAL_TEST_REQUIRED`, puis continuer ailleurs. Décision propriétaire → préparer options, risques, recommandation et PR reviewable ; `NEEDS_OWNER`. Infrastructure externe indisponible → diagnostiquer et classer `BLOCKED_EXTERNAL`, jamais `DONE`.

Une session Claude Code arrêtée **ne continue pas toute seule**. Utiliser la reprise du système `/goal` si fournie, ou un déclencheur extérieur explicite ; ne jamais prétendre disposer d'un daemon/scheduler non configuré. La non-interruption s'entend pendant les cycles d'exécution effectivement disponibles et au redémarrage via checkpoint.

## 5. LOT A — Tests / CI / E2E / flakiness

**Issues : #480, #486, #56, #564**, garde de CI de #581.

1. Capturer la matrice de tous les workflows pertinents : événement (`push`/`pull_request`), head SHA, statut terminal, job, test, artefact, raison, issue. Distinguer réussite `push` d'échec `pull_request` **sur le même SHA**.
2. Réexaminer le test palette de commandes → Team dans `packages/app/e2e/v110/work-team-panels.spec.ts:152` : le dernier audit a constaté `expect(palette).toHaveCount(0)` échouant avec `getByRole('dialog')` égal à 1 ; **hypothèse** : locator englobant le Team dialog. Lire `openPalette`, trace, vidéo, DOM, prouver l'hypothèse avant fix. Vérifier fermeture réelle palette ET ouverture Team. Ajouter régression RED puis correctif minimal.
3. #480 : trier chaque skip/fixme par groupes A/B/C, réactiver ce qui est obligatoire en RC-1, sinon documenter la disposition et l'issue ; consigner les chiffres précis `passed/failed/skipped` par exécution.
4. #486 : chercher cause server-switch ; exiger le critère des **5 runs `pull_request` consécutifs sur le même head**, sans simple rerun opportuniste.
5. #56 : injecter clocks/déterminisme, traiter distinctement chaque flake Windows, sans élargir massivement les délais.
6. Vérifier que les E2E critiques sont exigés par le gate final. Changement `.github/**` = PR réservée au propriétaire pour fusion.

**Sortie :** aucune régression RC-1 connue masquée ; tests pertinents et gates verts sur head exact ; exclusions documentées, non présentées comme PASS.

## 6. LOT B — Capacité RC-1 fonctionnelle et inventaire des contrôles

**Issues : #548, #580, #555–#564**, autres tickets fonctionnels seulement si #581 les rend nécessaires.

1. Inventorier chaque contrôle actif ou différé (Home, Chat, Code, Work/Team, Design, Automate, Memory, Terminal, Settings/Account, Voice) : `UI → action → API → autorité → effet durable → test → CI/head SHA` ; contrôler aussi routes 503, disabled hors « soon », menus cachés et keyboard/touch.
2. Garder grisées les fonctions non intégrées (issues #675–#682) ; ne pas coder par défaut les futurs outils ni maintenir un comportement placebo. Toute ambiguïté de l'issue historique vs décision plus récente va dans `NEEDS_OWNER` sans bloquer les autres lots.
3. #580 : run/start/pause/resume/cancel ; approvals/refus ; contrôle de policy/autonomy ; undo limité aux opérations réversibles ; generate/update project sur vraie autorité ; tests succès/refus/stale/reload/persistance/permissions. Pas de local UI-only state trompeur.
4. #555–#563 : examiner la portée par rapport à `RC1-SCOPE` avant toute implémentation. Ce qui est actif doit fonctionner, ce qui est différé est explicitement inactif ; pas de « nouvelle fonctionnalité » implicite.
5. #564 : pour chaque parcours critique, au moins nominal, refus, mauvaise entrée, erreur runtime/réseau, état obsolète, redémarrage/reload, absence d'effets de bord et preuve sur point d'entrée distribué. Un mock seul ne qualifie pas.

**Sortie :** matrice fonctionnelle complète, absence de faux succès, aucune fonction RC-1 active sans effet réel.

## 7. LOT C — Design, UI/UX, responsive, accessibilité

**Issues : #116, #549, #552, #553, #579**, liées à #550/#551/#588 selon les décisions du propriétaire.

Figer polices/tokens/assets, fixtures déterministes (identité du projet/branche, horaires, animations), baselines Linux et politique Windows/Linux explicite. Tester thèmes dark/light, breakpoints revendiqués, clavier, fermeture/modales, hover/touch, reduced-motion, focus et absence de débordement. Reproduire les écarts avant tout changement visuel ; ne pas requalifier sans besoin toute la parité déclarée acquise. Associer chaque résultat à un SHA et une baseline traçable.

**Sortie :** gates visuels et accessibilité reproductibles, régressions prouvées corrigées, exceptions explicites.

## 8. LOT D — Autorités, secrets, packages stratégiques

**Issues : #566–#574** (hors Browser UI reporté).

Pour chaque package `notShipped/deferred-runtime`, comparer aux chemins de production **réellement atteignables** depuis les `shippedRoots`. Décider selon l'autorité ratifiée : brancher si nécessaire, adopter l'existant avec ADR de supersession, ou reporter explicitement selon RC-1. **Ne jamais intégrer artificiellement pour rendre vert un manifest.**

- #566 : une autorité de capacité ; tests allow/deny/step-up/no-effects, vérifier contournements UI/API/tools.
- #567 : `secret-broker`, DLP, handle, logs, exports, Browser/Tool disclosures ; tests de non-divulgation.
- #568 : observabilité canonique, producteurs, retention, redaction et absence de métriques factices.
- #569 : gouvernance Knowledge sans autorité mémoire concurrente.
- #570 : Team/Work sans double writer de task/run, pas de câblage dormant artificiel.
- #571 : sandbox et computer-use privilégiés, fail-closed, permissions et réseau.
- #572 : artefacts, refs, persistance, versions et rollback.
- #573 : scheduler/media, conflits de ressources et autorité unique.
- #574 : remote-bridge/desktop-runtime, usages réellement pris en charge et sécurité.

Sur les changements sensibles, ADR + tests de refus + revue indépendante lorsque requis. Chaque issue doit nommer le point d'entrée de production qui fait preuve.

**Sortie :** autorité canonique démontrée et package manifest cohérent avec le produit livré.

## 9. LOT E — Dépendances, sécurité, builds reproductibles et signature

**Issues : #33, #444, #54, #56, #576** et gates RC-1 correspondants.

Trier et corriger de façon isolée les vulnérabilités Bun, Rust/Cargo, dépendances directes/transitives, natives, téléchargements et licences. Comparer `bun audit`/advisories actuelles et reachability ; toute acceptation de risque a propriétaire, conditions et date d'expiration. Relancer SDK sync après changement du générateur OpenAPI. Vérifier manifests interpackages/hoisting, Bun **1.3.11** (version du repo), lockfile, environnement clean-clone, téléchargement sécurisé et hashes Nix selon décision du propriétaire.

**Anomalie concrète d'audit à traiter :** `.github/workflows/release.yml` utilise un keystore Android CI généré dans la voie de publication réelle, alors que `.github/workflows/android.yml` a utilisé une clé de release configurée. Réconcilier signature dry-run vs signature officielle : dry-run non publiant → clé jetable possible ; publication → identité de release stable obligatoire et échec si secrets/identité absents. Tester empreinte d'identité, mise à jour et refus. Changement `.github/**` uniquement en PR, fusion par propriétaire ; **ne jamais créer ou exposer une clé de publication**. Vérifier l'état actuel avant de modifier : ce constat était vrai lors de l'audit précédent, pas une preuve à vie.

**Sortie :** risques bloquants corrigés ou acceptés formellement ; artefacts reproductibles et identité de signature contrôlée.

## 10. LOT F — Voice fonctionnelle et qualification plateforme

**Issues : #117, #575**, complément #576.

**Voice Android : fonctionnement constaté par propriétaire** sur les derniers builds. D'abord recueillir SHA, build, artefact, test utilisateur et logs si accessibles ; protéger le chemin natif, GPU et mode local. Ne pas réimplémenter sans régression reproductible. Ajouter les tests ciblés et de non-régression accessibles. Démontrer le périmètre Voice réellement inclus (D3) et expliciter fonctions différées. Voice Windows reste à qualifier séparément : ne pas déduire succès Windows d'Android.

Pour **Windows, Linux, Android** : build reproductible, install propre, lancement, sidecar correct, ressources Design, permissions, sessions, Work/Team, Code, Memory, Voice pertinent, accélération GPU/local, crash/restart, upgrade/rollback, signature/empreinte. Consigner SHA et checksum de chaque binaire. Sur Android vérifier les bibliothèques natives vendored/non reproductibles documentées dans `CLAUDE.md` ; leur présence seule ne démontre pas leur provenance. Les tests physiques manquants = `PHYSICAL_TEST_REQUIRED`, ne bloquent pas les tâches indépendantes et empêchent seulement de déclarer la plateforme certifiée.

**Sortie :** preuves par plateforme, aucune certification inférée du seul build CI.

## 11. LOT G — RC gelée, dry-run, GO/NO-GO

**Issues : #564, #575–#578.** Sélectionner un SHA immuable de `dev` seulement après intégration de tous les changements bloquants par les responsables. Une nouvelle correction entraîne une **nouvelle candidate**.

Sur ce SHA exact : CI finale, E2E/skips, sécurité, capacités actives, packages/autorités, visuel/a11y, Voice bornée, qualification Windows/Linux/Android ; exécuter les dry-runs non publiants autorisés en s'assurant préalablement que les workflows ne signent/ne publient rien ; produire SBOM SPDX/CycloneDX, checksums SHA-256, provenance, licences, notes de release, plan de rollback/upgrade et preuves de clean install.

Ne jamais appeler une action de publication, signature réelle, tag ou promotion. Remettre au propriétaire un rapport `GO` seulement si tous les gates sont prouvés ; sinon `NO-GO` et liste exhaustive des preuves manquantes. Ne pas simuler d'artefacts ou de signatures.

## 12. Standard de chaque modification / PR

1. Issue autorisée et responsabilité reconnue ; PR concurrentes inspectées.
2. Diagnostic documenté : cause racine + stratégie qui la corrige.
3. Worktree isolé, branche issue-nommée, base SHA `dev` courant, diff ≤400 lignes.
4. Tests ciblés du chemin réel, puis typecheck/lint/diff-check/tests adaptés ; Bun depuis répertoires packages, jamais suite racine interdite ; CI sur head SHA.
5. Rechercher le pattern corrigé dans le projet entier ; éviter les régressions et les changements hors périmètre.
6. Push **branche de travail seulement** ; PR vers `dev`, initialement DRAFT ; respecter `.github/pull_request_template.md` avec **les cinq titres exacts**, au moins une case de type et **deux cases de checklist réellement satisfaites** (si insuffisant, expliquer et ne pas tricher).
7. Lire status **terminal** des jobs au head SHA de la PR ; ne pas confondre SHA `dev` et SHA `merge_ref`, ni résultats `push` et `pull_request`.
8. Pas de merge, rebase forcée, cleanup destructif, publication ni clôture prématurée d'issue.
9. Si PR validée, la mettre en état approprié pour revue propriétaire et passer au prochain lot indépendant.

## 13. Checkpoint et reprise

Le checkpoint de travail (conservé par la couche `/goal` si elle le permet, sinon dans un fichier de session **non commité** et/ou dans les commentaires PR/issues de suivi) contient **sans secret** : UTC, référence des docs d'autorité, SHAs `main/dev/dev_auto`, état invariant, epic/issue, état machine, branche, PR, head SHA, CI run IDs, tests et commandes réellement exécutées, diff, blockers/owner, prochaine tâche READY, tentatives et alternatives. À chaque nouveau démarrage, le recalcul depuis GitHub supplante le checkpoint.

Ne pas créer une PR documentaire purement administrative après chaque cycle. Pour une mise à jour durable utile au dépôt, créer une PR dédiée sans pousser directement sur `dev`.

**États de pause :** `NEEDS_OWNER` / `PHYSICAL_TEST_REQUIRED` / `BLOCKED_EXTERNAL` n'arrêtent pas le reste de la file. S'il n'existe plus aucune tâche indépendante `READY`, conclure honnêtement avec les blocages et les actions propriétaires, au lieu de boucler à vide ou de promettre un travail en arrière-plan.

## 14. Rapport de cycle et final

**Chaque cycle utile :** issue/lot, cause, fichiers modifiés, branche, PR, head SHA, tests locaux, runs CI vérifiés, résultat (CI_PASS/FAIL/UNKNOWN), anomalies, blocages, prochaine tâche indépendante.

**Résumé de campagne :** backlog RC-1 restant, PR DRAFT/READY, flakiness et skips exacts, risques sécurité, décisions propriétaires, preuves natives manquantes, tableau de gates par SHA. Aucune conclusion « tout vert » sans résultat sur une candidate unique.

## 15. Terminaison

L'objectif s'arrête en `RC1_TECHNICALLY_READY_FOR_OWNER_REVIEW` uniquement lorsque les contraintes RC-1 peuvent être **démontrées** sur un SHA immuable : opérations fonctionnelles, permissions et secrets, tests, UI/accessibilité, Voice prévue, Windows/Linux/Android, artefacts/reproductibilité, sécurité et dry-run. Il reste `NEEDS_OWNER` avant tout GO final si la signature physique/édition, le merge ou la publication manque.

**Boucle obligatoire :** analyser → diagnostiquer → reproduire RED → correctif minimal → tests → PR → CI sur head SHA → checkpoint → prochaine tâche autorisée. Après chaque PR, revenir **à l'ensemble** de #581, pas uniquement à l'issue précédente.
