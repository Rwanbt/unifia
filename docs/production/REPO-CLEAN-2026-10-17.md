# REPO_CLEAN — 2026-10-17

<!-- SPDX-License-Identifier: MIT -->
<!-- Établi par l'agent (Mission Codex RC-1). Read-only : aucune branche n'a été
     supprimée, aucun worktree d'un autre agent n'a été touché. Seul un nettoyage
     de MES 9 worktrees fusionnés a eu lieu plus tôt (disque D: plein, 24,5 GB
     libérés ; branches conservées). -->

## 1. Ascendance des branches permanentes — VÉRIFIÉ

| Branche | SHA | Relation |
|---|---|---|
| `main` | `0d9539cad7` | ⊂ `dev` (merge-base --is-ancestor = 0) |
| `dev` | `24adc8cabc` | HEAD d'intégration |
| `dev_auto` | `1ec9457740` | `dev` ⊂ `dev_auto` ; ahead = 17 (18/10 : promotion via PR propriétaire) |

## 2. Provenance #753 et workflows post-fusion — VÉRIFIÉ

- #753 : MERGED le 2026-10-17T10:10:32Z, merge commit `1ec9457740ff8317efdb196a9a284821c9857bcf`, branche head `dev` (sync `dev → dev_auto`, merge commit — convention respectée).
- 4 workflows au SHA `1ec9457740` : `typecheck`, `unifia-conformance`, `CodeQL`, `test` — **tous SUCCESS**.

## 3. Branches distantes — inventaire complet (21 refs, ahead/behind vs `dev`)

### Intégrées / permanentes
| Branche | SHA | État |
|---|---|---|
| `main` | `0d9539cad7` | permanente, ⊂ dev |
| `dev` | `24adc8cabc` | permanente |
| `dev_auto` | `1ec9457740` | permanente, ahead=17 |

### Actives (portent une PR ouverte) — 13 branches / 13 PR
| Branche | SHA | PR |
|---|---|---|
| `fix/571-desktop-broker-composition` | `a2c1fbcadf` | #769 (agent, Ready) |
| `fix/727-workbench-ci-timeout` | `178315f29a` | #768 (agent, Ready) |
| `fix/571-sandbox-auto-enforcement` | `ac138f6c44` | #767 Ready |
| `fix/571-docker-limited-egress-failclosed` | `d9109267f9` | #766 Ready |
| `fix/571-desktop-policy-error-boundary` | `e245201d99` | #765 Ready |
| `fix/574-git-blame-textconv-authority` | `f67cfc3aca` | #755 Ready |
| `fix/549-visual-header-identity` | `071f5dfb5f` | #714 Ready |
| `fix/480-composer-dock-overlap` | `078bf5eb3a` | #724 Ready |
| `fix/729-design-studio-content-gate` | `657f3e9805` | #751 Ready |
| `fix/552-design-visual-baselines` | `b51a1c0054` | #727 Draft |
| `fix/480-recover-under-lock` | `5520a48b67` | #722 Ready (ADR-1050) |
| `fix/576-android-release-signing` | `b6c54a3060` | #702 Draft (autorité propriétaire) |
| `fix/548-deferred-control-labels` | `d1be3fc55d` | #770 (agent, Draft — CI) |

### Orphelines — PR fermée, commits uniques NON intégrés (DISPOSITION PROPRIÉTAIRE REQUISE, NE PAS SUPPRIMER)
| Branche | SHA | Constat mesuré |
|---|---|---|
| `fix/734-session-review-rows` | `d18cbf3d7a` | PR #735 FERMÉE (2026-10-16, jamais fusionnée). `git cherry origin/dev` : **2 commits `+`** (aucun équivalent dans dev). Le tip conserve le scroll test skip « with its measured cause ». |
| `voice` | `441b61db19` | PR #691 FERMÉE (2026-10-14, jamais fusionnée). 6 commits dont **5 `+` (absents de dev)** et 1 `-` (`ba40f4d2d4` déjà présent par équivalence de patch). Contenu : fixes Voice/Pocket/Live Android (front-end FR du pack Pocket, garde jniLibs, transcription de rendus répétés, capture micro sans second WebView, causes d'échec Live). **Voice Android est à préserver** — décision propriétaire, aucun push/fusion par l'agent. |

### Legacy — lignées fork divergentes (NE PAS TOUCHER)
| Branche | SHA | Constat |
|---|---|---|
| `contrib/android-remote-01-native-webview` | `19727cb6fc` | ahead≈20 436 / behind≈13 717 — historique de fork séparé |
| `feat/upstream-android-remote` | `1ed6459b65` | idem |

## 4. Workflows sécurisés — état

- **#59** (« `check-duplicates` never reports on PRs ») : **CLOSED**. Aucun check `check-duplicates` sur les PR actuelles (le gate bloqué n'existe plus).
- Workflows sécurité présents sur `dev` : `codeql.yml` (CodeQL exécuté sur les PR — vu sur #767/#769), `sbom.yml`, `slsa.yml`, `release-sign.yml`, `vouch-check-pr.yml`, `vouch-check-issue.yml`, `duplicate-issues.yml`.
- Aucune modification `.github/**` par l'agent (interdit sans voie propriétaire).

## 5. Worktrees — inventaire

- ~70 worktrees listés. Trois worktrees portent un préfixe `480`/`722` dont `rc1-724-composer-dock` (chantier #724) et `D:/App/unifia/.worktrees/rc1-480-skip-records` (hors repo principal — autre agent/owner).
- Rappel incident du 17/10 : disque D: plein → purge de **mes** 9 worktrees fusionnés uniquement (branches conservées). `core.longpaths=true` activé. Aucun worktree appartenant à un autre agent n'a été touché.

## 6. Décisions techniques consignées

1. **Aucune suppression de branche** : les 2 orphelines (`fix/734`, `voice`) portent du travail unique mesuré par `git cherry` ; leur sort appartient au propriétaire.
2. **`voice`** : la PR #533 (« record the voice branch as merged into dev ») couvre une génération antérieure ; les 5 patches postérieurs restent absents de `dev`. À décider : PR de récupération vers `dev` ou ré-implémentation — l'agent ne pousse rien sur cette branche.
3. **`fix/734`** : 2 commits de tests e2e (locators du review heading) ; le sujet a peut-être été repris autrement — sinon candidat à re-prise.
4. **`dev_auto` ahead=17** : attendu (boucle IA planifiée) ; promotion uniquement par PR revue propriétaire.
5. Les forks legacy ne sont ni fusionnables ni supprimables par l'agent (lignée divergente ~20k commits — probablement historique de la bifurcation upstream).

## 7. Limites de ce rapport

- Établi en read-only le 2026-10-17 ; les SHA des branches de PR peuvent évoluer à chaque push.
- Le rapport ne remplace pas une preuve CI : chaque PR citée porte son propre run au SHA exact.
