# UNIFIA — Plan RC-0 (fast-track), version 2.2, dérivé du rebaseline v2.0

**Statut :** décisions D1–D9 validées par le propriétaire le 29/09/2026 ; D10, D11 et O1–O5 ouvertes (`DECISIONS.md`)
**Base :** `UNIFIA-PLAN-REBASELINE-v2.0` (97 tâches, checksums vérifiés) · **Baseline observée :** `new-ui@2c13b7d76d0fdbec33af3952825e6bf84e930df5` (RB00 doit re-lire HEAD)
**Graphe machine-readable :** `TASK-GRAPH-RC0.json` (104 tâches, acyclique, champs `train` et `owner_only`)

## 1. Principe : tout est câblé, train par train, jusqu'à `dev`

Le périmètre reste celui du v2.0 : **tout câbler, sans exception**. Le programme est découpé en trois **trains**. Chaque train se termine par un état de **`dev` prêt pour tes tests manuels**. Le travail automatisé s'arrête là. **Toi seul** décides ensuite de passer de `dev` à `main` et de tagger la release (`release.yml`). **Il n'y a pas de bêta** : les releases sont directes. La branche par défaut est `main`.

| Train | Livré sur `dev` | Contenu |
|---|---|---|
| **1** | Release 1 candidate | Rebaseline, synchronisation de `dev`, blockers runtime, Automate runtime, Work/Kanban fonctionnel, Memory rename, Code parity, **Voice (périmètre RC-0)**, CI/sécurité/release, Windows + Linux + Android |
| **2** | Release 2 candidate | **Browser complet**, fermeture fonctionnelle Work/Automate/Code/Settings, câblage des moteurs liés, fin de Voice (G9, G12, Pocket Android, STT streaming Android) |
| **3** | Release 3 candidate | Backends Settings/Compte, observabilité, artefacts, remote, matrice UI/a11y/responsive complète, matrice de plateformes complète, `PROGRAM_COMPLETE` v2.0 |

Une fonction pas encore livrée est **masquée ou étiquetée « bientôt »**, jamais factice (règle v2.0 : *code présent ≠ capacité livrée*). Tu choisis, pour chaque train, de promouvoir vers `main` (une release par train) ou d'attendre la fin du train 3 : le graphe supporte les deux.

## 2. Tes décisions et leur traduction

| # | Décision | Traduction dans le plan |
|---|---|---|
| D1 | A : step-up pour `workflow.run` | CR03 tranché : ajouter `workflow.run` à `STEP_UP_ELIGIBLE_CAPABILITIES`, adapter `capability-scope.test.ts`. Tu fusionnes toi-même cette PR. |
| D2 | A : Browser masqué, mise à jour progressive | BR00–BR10 + UI12 au **train 2**. |
| D3 | B : Voice inclus | VO00–VO05 au **train 1**, périmètre borné (§4). |
| D4 | Implémenter #86, #93, #96 | CR06, CR07, CR08 au train 1. |
| D5 | Windows, Linux, Android | QA13 (train 1). macOS, iOS, Web/PWA : `EXPLICITLY_NOT_IN_THIS_RELEASE` en release 1 ; matrice complète en train 3. |
| D6 | Parité visuelle atteinte | UI00 = vérification (harnais existant, SHA candidat, exe desktop). Slices trouvées OPEN → train 3. |
| D7 | Pas de bêta, releases directes | QA14 devient un audit du pipeline `release.yml` (sans canal beta, sans publication). |
| D8 | `work-design` dans `new-ui` ; branche par défaut `main` | **Vérifié.** RL02 = fast-forward de `work-design`. `AGENTS.md` se contredit : carte DOC01. |
| D9 | Le travail automatisé s'arrête à `dev` | RL03–RL07 et P0 sont `owner_only`. Aucun agent ne touche `main`, ne tague ni ne publie. |

## 3. Ce qui a été vérifié pour ces décisions

- **D8 confirmé.** `new-ui` a 660 commits de plus que `work-design`, 1457 de plus que `dev`, 1466 de plus que `main`, et aucun de ces trois n'a de commit absent de `new-ui`. La synchronisation de `dev` n'apporte donc aucun contenu divergent à réconcilier ; le delta représente cependant 2410 fichiers.
- **D6 plausible, à prouver.** L'audit de parité du 28/09 listait deux P0 (A1 : modes sans surface visible ; C1 : Work cassé sur mobile). Les plans d'exécution T1 et T2 les traitent, et `EXECUTION-LOG.md` les marque OK (1 668 tests verts, 24 paires de captures). Une réserve figure dans l'audit lui-même : Work, Automate et Memory n'ont été vus qu'en web dev, où le pont Workbench échoue. **UI00 doit donc vérifier ces trois surfaces sur l'exe desktop.**
- **D3 : Voice n'est pas encore « quasi prêt » selon sa propre doc.** `docs/UNIFIA-VOICE-V2.2-FINAL-QUALIFICATION.md` (branche `voice`) conclut « IMPLEMENTATION COMPLETE / PRODUCTION QUALIFICATION BLOCKED ». Ce qui est réel : VoiceCore, audio natif Android (Oboe), Silero VAD, Smart Turn, STT final Parakeet, provider de streaming STT (validé en 5 langues côté host), CI verte. Ce qui reste ouvert : qualification physique du micro et des routes, aucun AEC/NS/AGC intégré, TTS Pocket Android encore un scaffold (`productionReady: false`), STT streaming Android bloqué par une cross-compilation NDK, endurance de 60 min, full-duplex. La branche a encore reçu des commits le 29/09 et accuse 42 commits de retard sur `new-ui`.

## 4. Périmètre Voice de la release 1 (validé avec D3)

**Inclus (VO00–VO05) :** intégration sur une branche fraîche issue de `dev` après P0 (sans réécriture d'historique) ; parcours Live Android avec Oboe, Silero, Smart Turn et STT final Parakeet ; chemin desktop Windows ; TTS système Android conservé comme repli étiqueté ; modèles épinglés et vérifiés par hash ; Voice reste en entrée/sortie seulement (ADR-065) ; CI voice bloquante ; qualification physique sur ton appareil Android et un hôte Windows.

**Déplacé au train 2 (VO06) :** Pocket TTS Android, chaîne AEC/NS/AGC, STT streaming Android (NDK), endurance G12, routes Bluetooth, full-duplex (G9).

Tout ce qui est déplacé est masqué ou étiqueté dans l'UI de la release 1. Si tu veux que l'un de ces éléments soit dans la release 1, il faut le dire maintenant : le délai augmentera, car ce sont les éléments qui exigent des tests physiques et un build NDK.

## 5. Gate du train 1 (QA12R), sur un SHA immuable de `dev`

1. CI complète verte (unit Linux/Windows, E2E, typecheck, conformance) et `check-package-wiring` vert, **sur des PR vers `dev`** (la preuve CI vient des PR de lots).
2. Correctifs CI et flakes : QA00–QA03 ; sécurité et dépendances : QA04–QA07 ; audit du pipeline de release : QA14.
3. Aucun contrôle factice visible ; tout ce qui est reporté est masqué ou étiqueté (RB05 restreint aux surfaces livrées, FX00).
4. Blockers #77, #35, #86, #93, #96, #99, #103 fermés avec preuve.
5. Voice : périmètre §4 qualifié (VO04), avec tes tests physiques.
6. Windows, Linux, Android : build, démarrage propre et parcours principaux (QA13).
7. Essai à blanc de la release signée avec SBOM et SLSA (QA09), **sans publier**.
8. Zéro P0/P1 non approuvé.

**Puis, côté agent :** RL00 (gel du SHA candidat, checklist de tests manuels, limites connues), RL01 (notes de release, rollback, essai à blanc), RL02 (alignement de `work-design`). **Fin du travail automatisé.**
**Puis, côté propriétaire :** RL03 (tests manuels, décision go/no-go, PR `dev` → `main`), RL04 (tag `vX.Y.Z`, `release.yml`), RL05 (smoke sur installation propre), RL06 (preuve de rollback), RL07 (publication et surveillance).

Non exigé au train 1 : parité pixel re-certifiée, matrice responsive/a11y complète, Browser, matrice de six plateformes, câblage de tous les moteurs.

## 6. Branches : `main` (défaut, propriétaire) ← `dev` (intégration, agents) ← lots

**Synchronisation unique P0 (propriétaire).** `dev` est un ancêtre de `new-ui` (delta : 2410 fichiers). Avant tout lot de code, `dev` reçoit le SHA de baseline figé par RB00. Ensuite, chaque lot = une branche `agent/<ID>-<slug>` depuis `origin/dev` et une PR ≤ 400 lignes vers `dev`. Cela règle le gate de taille pour les lots ; il ne bloque que P0.

**Gate de taille (D10).** `work-design-integrity.yml` exécute `scripts/check-pr-size.sh dev` (limite 400 lignes) sur toute PR vers `dev`. Options pour P0 : **A** exemption versionnée pour une PR de promotion en *merge commit* ; **B** poussée directe du SHA avec contournement (fast-forward) ; **C** tranches, écartée. Pas de squash : il effacerait l'historique de 1457 commits.

**Effets de bord d'un push sur `dev` (vérifiés).** `containers.yml` pousse des images vers `ghcr.io/<propriétaire>` (déclenché par la synchronisation, qui touche `packages/containers/**` et `package.json`) ; `generate.yml` pousse un commit bot après chaque push ; `nix-hashes.yml` peut aussi pousser ; `publish.yml` est gardé par `github.repository == 'anomalyco/opencode'` (à confirmer pour tous ses jobs). Ces effets sont à accepter explicitement (O5).

**Releases (propriétaire).** `release.yml` se déclenche sur un tag `v*` (option brouillon). Il n'y a pas de canal beta. `beta.yml` ne publie rien ; `publish.yml` sur `beta` viserait `anomalyco/opencode-beta` : jamais utilisés.

## 7. Trains et tâches

### Train 1 — release 1 candidate
| ID | Lot | Taille | Dépend de |
|---|---|---:|---|
| RB00 | Freeze exact implementation baseline and branch heads | S | — |
| RB01 | Reconcile current audits, ADRs, issues and v1.5 requirements | L | RB00 |
| RB02 | Generate current branch/divergence and promotion map | M | RB00 |
| RB03 | Run clean build/test/conformance baseline on an RC branch | L | RB00, RB02 |
| RB04 | Freeze shipped-package reachability graph | M | RB00 |
| RB05 | Journey truth table for every visible control on SHIPPED surfaces | XL | RB01, RB04 |
| RB06 | Security/dependency/licence/release delta scan | L | RB00 |
| RB07 | Approve production scope and deferred-feature policy | S | RB01, RB05, RB06 |
| CR01 | Fix session runner deadlock after Stop on hanging generation | L | P0, RB03 |
| CR02 | Fix fresh-install Team model selector cardinality deadlock | M | P0, RB03 |
| CR03 | Authorize workflow.run via explicit step-up capability policy | M | P0, RB01 |
| CR04 | Execute canonical Automate graph IR instead of linearized steps | XL | CR03 |
| CR05 | Make Automate run authority durable for list/resume/cancel | L | CR03 |
| CR06 | Add safe Team task-status mutation capability | XL | P0, RB01 |
| CR07 | Transactional/best-effort Memory wikilink refactor on rename | L | P0, RB01 |
| CR08 | Close remaining Code editor parity runtime gaps | XL | P0, RB01 |
| CR09 | Remove remaining hard-coded Design copy and widen i18n guards | M | P0, RB01 |
| CR10 | Critical journey exit gate | L | CR01, CR02, CR03, CR04, CR05, CR06, CR07, CR08, CR09 |
| UI00 | Verify v110 parity claim (S0-S14) on the RC SHA with the existing harness, incl. desktop bridge | M | RB03 |
| FX00 | Classify every SOON/disabled control against production scope | M | RB05, RB07 |
| FX01 | Work action APIs: Run, Approve, Policy, Undo, Generate update | XL | CR06, FX00, P0 |
| PW00 | Strategic package wiring policy | M | RB04, RB07 |
| PW01 | Wire capability-runtime into shipped authority path | L | CR03, P0, PW00 |
| VO00 | Freeze voice/new-ui divergence and integration strategy | M | RB02 |
| VO01 | Integrate voice changes onto current new-ui candidate | XL | P0, VO00 |
| VO02 | Voice v2.2 - RC-0 scope: shipped-path providers real (Android Live: Oboe + Silero + Smart Turn + Parakeet final STT; Windows desktop path) | XL | VO01 |
| VO03 | Blocking Voice CI and deterministic model-artifact qualification | L | VO02 |
| VO04 | Physical Android + Windows voice qualification - RC-0 scope (Live, route, lifecycle, 5 languages on shipped path) | XL | VO03 |
| VO05 | Merge-qualified voice into RC | M | VO04 |
| QA00 | Fix conformance fail-fast so full failure set is visible | S | P0, RB03 |
| QA01 | Remove/repair stuck check-duplicates status | S | P0, RB03 |
| QA02 | Harden Windows unit flakes and instance-capacity nondeterminism | L | P0, RB03 |
| QA03 | Harden E2E runner starvation/flakes | L | P0, RB03 |
| QA04 | Close CodeQL/security + LSP E2E production gate | L | P0, RB06 |
| QA05 | Patch/triage direct dependency vulnerabilities in isolated batches | XL | P0, RB06 |
| QA06 | Declare direct cross-package dependencies instead of relying on hoisting | L | P0, RB06 |
| QA07 | Verify unifia.ai remediation and no executable dangling domain | M | RB06 |
| QA08 | Physical mobile QA and release sign-offs | XL | CR02, VO04 |
| QA09 | Release workflow/signing/SBOM/SLSA dry run | L | QA04, QA05, QA14 |
| QA10 | Protected-branch policy for integration promotion | M | RB02, QA00, QA01 |
| RL00 | Freeze the release-1 candidate SHA on dev and publish the manual-test handoff | S | QA12R |
| RL01 | Prepare the release package: changelog, release notes, known limitations, rollback notes, release dry run | M | RL00 |
| RL02 | Align work-design to the dev tip (work-design is an ancestor: fast-forward, no content review) | S | RL00 |
| RL03 | OWNER: manual tests on dev, then decide and open the dev -> main PR **(propriétaire)** | M | RL01, RL02 |
| RL04 | OWNER: tag vX.Y.Z on main; release.yml builds and signs the release **(propriétaire)** | L | RL03 |
| RL05 | OWNER/QA: clean-install smoke of the release artifacts on Windows/Linux/Android **(propriétaire)** | XL | RL04 |
| RL06 | OWNER: rollback proof and retained artifacts **(propriétaire)** | M | RL05 |
| RL07 | OWNER: publish the release and watch the post-release window **(propriétaire)** | M | RL06 |
| RL08 | Close the release cycle: reconcile issues/tasks, archive superseded branches and plans | M | RL07 |
| QA13 | Platform qualification lite: Windows, Linux, Android (build + clean start + core journeys on RC SHA) | L | CR10, VO05, QA08 |
| QA12R | Release-1 gate on one immutable dev SHA: CI/security/functional/voice/platform | L | CR10, FX01, PW01, QA00, QA01, QA02, QA03, QA04, QA05, QA06, QA07, QA08, QA09, QA10, QA13, QA14, RB05, UI00, VO05 |
| QA14 | Release pipeline audit: no release channel; neutralize inherited upstream targets; review side effects of pushes to dev | L | P0, RB03 |
| P0 | One-time sync of dev to the frozen new-ui baseline (dev is an ancestor of new-ui) - OWNER-EXECUTED **(propriétaire)** | M | RB02, RB03 |

### Train 2 — release 2 candidate
| ID | Lot | Taille | Dépend de |
|---|---|---:|---|
| UI01 | Certify and complete deterministic visual parity harness | L | UI00 |
| UI02 | Freeze typography/tokens/assets for deterministic rendering | M | UI01 |
| UI12 | Pixel-parity closure: Browser after real runtime integration | L | UI02, BR10 |
| BR00 | Preserve Browser route/session/workspace identity | M | RB01 |
| BR01 | Canonical Browser service, session/tab lifecycle and active-tab authority | XL | BR00 |
| BR02 | Render the same Browser runtime that receives actions | L | BR01 |
| BR03 | Workbench Browser transport/events and agent tools | XL | BR01, BR02 |
| BR04 | Observation receipts and stale-action rejection | L | BR03 |
| BR05 | User takeover / AI pause-resume authority | L | BR04 |
| BR06 | Route Browser network through Network Authority and SSRF policy | XL | BR01 |
| BR07 | Secret scrubbing and prompt-injection boundaries | XL | BR03, BR06 |
| BR08 | Download quarantine and explicit release flow | L | BR06 |
| BR09 | Workspace profile isolation, popup/permission/device policy | L | BR01, BR06 |
| BR10 | Browser E2E and security certification | XL | BR02, BR03, BR04, BR05, BR06, BR07, BR08, BR09 |
| FX02 | Automate dry-run/test mode, fixtures and → Work handoff | XL | CR04, FX00 |
| FX03 | Automate scheduler and external trigger closure | XL | CR04 |
| FX04 | Node configuration editors for runnable Automate families | XL | CR04 |
| FX05 | Terminal Problems/Output/Tests/Debug/Ports producers | XL | FX00 |
| FX06 | Code inspector context injection and task actions | L | FX00, CR08 |
| FX07 | Settings AI routing/local/fallback profiles | L | FX00 |
| PW02 | Wire secret-broker into shipped secret/tool/browser boundaries | L | PW00, BR07 |
| PW04 | Wire memory-governance or replace with canonical shipped authority | L | PW00, CR07 |
| PW05 | Wire workbench-orchestrator into Work/Team execution or deprecate it | L | PW00, FX01 |
| PW06 | Wire browser-runtime into Browser service | L | PW00, BR01 |
| PW07 | Wire sandbox-drivers + computer-use-safety where privileged execution ships | XL | PW00, BR06 |
| PW09 | Wire scheduler/media-runtime where triggers/voice/multimodal require them | L | PW00, FX03, VO02 |
| VO06 | Voice completion: Pocket Android TTS, AEC/APM chain (G9), Android streaming STT (NDK), endurance G12, Bluetooth routes | XL | VO05 |
| R2 | Train 2 gate: everything on dev, ready for the owner manual tests (Browser, Work/Automate/Code/Settings closure, Voice completion) | XL | BR10, UI12, FX02, FX03, FX04, FX05, FX06, FX07, PW02, PW04, PW05, PW06, PW07, PW09, VO06, RL02 |

### Train 3 — release 3 candidate
| ID | Lot | Taille | Dépend de |
|---|---|---:|---|
| UI03 | Pixel-parity closure: Home | L | UI02 |
| UI04 | Pixel-parity closure: Shell | L | UI02 |
| UI05 | Pixel-parity closure: Chat/session | L | UI02 |
| UI06 | Pixel-parity closure: Code | L | UI02 |
| UI07 | Pixel-parity closure: Work | L | UI02, CR06 |
| UI08 | Pixel-parity closure: Design | L | UI02 |
| UI09 | Pixel-parity closure: Automate | L | UI02, CR04 |
| UI10 | Pixel-parity closure: Memory | L | UI02 |
| UI11 | Pixel-parity closure: Settings/User | L | UI02 |
| UI13 | Responsive matrix across all shipped surfaces | XL | UI03, UI04, UI05, UI06, UI07, UI08, UI09, UI10, UI11, UI12 |
| UI14 | Motion, hover, keyboard and reduced-motion certification | L | UI13 |
| UI15 | A11y + final visual gate | L | UI14 |
| FX08 | Settings Compute/Network/Security/System/Hooks backends | XL | FX00 |
| FX09 | Account session sync/security/org actions | XL | FX00 |
| FX10 | Observability producers for declared domains | L | FX01, FX02, BR10 |
| FX11 | Functional-closure E2E matrix | XL | FX01, FX02, FX03, FX04, FX05, FX06, FX07, FX08, FX09, FX10 |
| PW03 | Wire observability package into canonical event path | L | PW00, FX10 |
| PW08 | Wire artifact-store/studio/document-packs/generative-ui where production artifacts require them | XL | PW00 |
| PW10 | Resolve remote-bridge/desktop-runtime against device/control-plane scope | XL | PW00 |
| PW11 | Package reachability final gate | M | PW01, PW02, PW03, PW04, PW05, PW06, PW07, PW08, PW09, PW10 |
| QA11 | Cross-platform production target matrix and platform qualification | XL | BR10, CR10, FX11, PW11, QA08, QA09, R2, UI15, VO05 |
| QA12 | Production hardening gate | XL | BR10, CR10, FX11, PW11, QA02, QA03, QA04, QA05, QA06, QA07, QA08, QA09, QA10, QA11, R2, UI15, VO05, VO06 |
| R3 | Train 3 gate: full program on dev, ready for the owner manual tests and release | L | QA12 |

Les tâches `RB*`, `CR*`, `BR*`, `FX*`, `PW*`, `UI*`, `QA*` et `VO0*` gardent leurs critères de sortie du v2.0 (voir `TASK-GRAPH-RC0.json`), sauf celles modifiées : UI00, RB02, RB05, VO02, VO04, QA14, QA12R, RL00–RL08. Nouvelles : P0, VO06, QA13, QA12R, QA14, R2, R3.

## 8. Délais (estimations)

Méthode : S ≈ 0,5 j, M ≈ 1 j, L ≈ 2,25 j, XL ≈ 4 j de travail agent, appliqués au chemin critique du graphe, puis marge de 20 à 50 % pour CI, revues, décisions et ressources sérialisées. Ordres de grandeur, calibrés sur ton rythme récent (≈ 1 000 commits en 4 semaines). **Sont exclus** : ton temps de tests manuels, les tests physiques que tu dois faire (VO04, QA08), P0 et les étapes RL03–RL07.

| Jalon (côté agent : livré sur `dev`) | Chemin critique | Estimation |
|---|---|---|
| **Release 1 candidate** | ≈ 29 jours de travail (≈ 6 semaines) | **7 à 9 semaines**, soit mi-novembre à début décembre 2026 |
| Pour comparaison : sans Voice | ≈ 18 jours | 4,5 à 5,5 semaines (début novembre) |
| **Release 2 candidate** | Browser (≈ 20 j) en parallèle du train 1, puis fermeture fonctionnelle | **+3 à 5 semaines** après la release 1, soit mi-décembre à début janvier |
| **Release 3 candidate** (programme complet) | ≈ 43 jours (≈ 9 semaines) | **12 à 16 semaines**, soit fin décembre 2026 à mi-janvier 2027 |

Le chemin critique du train 1 est la voie Voice (intégration → qualification physique). Les blockers CR04/CR06/CR07/CR08 se font en parallèle et ne sont pas sur ce chemin.

## 9. Risques et points ouverts

1. **Voice Android** : incertitude la plus forte (tests physiques, audio natif). Décider tôt si une régression audio retarde la release 1 ou ramène Voice au train 2.
2. **Effets de bord de `dev`** (images `ghcr.io`, commits bot) : à accepter avant P0.
3. **Ressources sérialisées** : lockfile, SDK, routeurs et workflows de release ne se parallélisent pas ; lots XL en PR ≤ 400 lignes.
4. **Périmètres de fichiers** : RB01 doit les résoudre avant tout démarrage d'agent (PW01–PW10 et QA12 sont génériques dans le v2.0).
5. **Statut des issues** non vérifié côté GitHub (RB01).
6. **Numéro de version** : `VERSION` indique `1.3.15` (O2).
7. **Politique des contrôles « SOON »** et **statut des moteurs non livrés** (O1, O3).
8. **Ancien graphe** : `docs/autonomy/TASK-GRAPH-v2.0.yaml` (Hermes, juillet 2026) existe déjà ; ne pas le confondre. Déposer ce pack dans `docs/autonomy/rc0/`.
9. **`dev` bouge sans les agents** (commit bot de `generate.yml`) : faire `git fetch` avant chaque PR.

## 10. Premières actions (jour 1)

1. **Toi :** confirme D10 (A ou B), D11 (les agents fusionnent-ils dans `dev` ?) et O5 (effets de bord).
2. **Agent :** RB00 → RB02 → RB03 → RB01 → VO00 (mesure et documents, aucun code).
3. **Toi :** exécute P0 (`cards/CARD-P0-OWNER.md`).
4. **Agent :** vérifie `P0-OK`, puis DOC01, QA14 (analyse), CR03 (que tu fusionnes), puis le graphe du train 1.
