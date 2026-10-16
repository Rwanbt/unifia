<!-- SPDX-License-Identifier: MIT -->
# Arbitrages propriétaire — RC-1 — 16 octobre 2026

**RATIFIÉ par le propriétaire le 16/10/2026.** Ce registre complète DECISIONS.md, les décisions du 05/10 et du 14/10 (#660). Source normative pour les agents après intégration à dev ; les issues GitHub ont été annotées immédiatement. Priorité conservée : #597 REPO_CLEAN, puis file #581. Aucun statut livré ou GO PROD n'est attribué par une décision de périmètre.

## Décisions verrouillées — ne plus demander au propriétaire

| Issue | Choix propriétaire | Implémentation / critère vérifiable |
| --- | --- | --- |
| [#733](https://github.com/Rwanbt/unifia/issues/733) | **B : supprimer les 3 appels client Knowledge sans route serveur ; ne pas ajouter d'endpoint.** | Vérifier absence d'appelants directs, indirects et publics ; préserver le CLI, le serveur existant et le panneau Mémoire via Files ; tests, typecheck, CI. En cas de consommateur réel nouvellement découvert, suspendre la suppression concernée et documenter, sans inventer de route. |
| [#588](https://github.com/Rwanbt/unifia/issues/588) | **Confirmation du 14/10** : diff desktop canonique REQUIRED (#663) ; compact/mobile NOT_IN_RC1. | Ne pas monter MobileDiff ni créer un second état. Reporter explicitement les anciens critères mobiles de l'issue après RC-1 et corriger la matrice avant clôture. |
| [#736](https://github.com/Rwanbt/unifia/issues/736) / [#734](https://github.com/Rwanbt/unifia/issues/734) | **Corriger le scroll Review dans RC-1** ; #734 closed by protocol, défaut réel suivi par #736. | Éviter la disparition transitoire de la géométrie et la perte d'ancre sous refresh ; ne pas restaurer l'état d'une session précédente. Corriger le test du virtualiseur, RED→GREEN et E2E Linux au SHA exact. |
| [#552](https://github.com/Rwanbt/unifia/issues/552) | **A : générer les baselines Linux sur un runner Ubuntu GitHub Actions contrôlé.** | Fixture, versions et identités déterministes ; sortie en artefacts inspectables ; revue et commit par PR ; nouveau run séparé de comparaison. Jamais une baseline auto-approuvée par le run qui la mesure ; fichiers .github sous contrôle propriétaire. |
| [#729](https://github.com/Rwanbt/unifia/issues/729) | **RC-1 REQUIRED : le gate Design doit voir le contenu réel du studio** (correction d'infrastructure de test, non nouvelle feature). | Artefact fixture déterministe via Workbench canonique, couches/tokens/texte rendus ; mutation du rendu détectée par gate ; deux runs stables, coordonnées avec #552. L'ancien report post-RC-1 est annulé. |
| [#279](https://github.com/Rwanbt/unifia/issues/279) | **Décision existante du 05/10 : hôte Node dédié pour Playwright**, Bun orchestrateur ; Browser DEFERRED_HIDDEN en RC-1. | #593 contient le test de fondation ; l'UI et la certification Browser relèvent du train suivant (#118/#554). Ne pas rouvrir le débat Node/CDP/Bun. |
| [#553](https://github.com/Rwanbt/unifia/issues/553) | Certifier les surfaces livrées sur la matrice viewport ; Browser masqué explicitement hors RC-1. | Home, Chat, Code, Work, Design, Automate, Memory, Settings : overflow, actions, focus, clavier/tactile, comportement interactif. Fractionner les tests si OOM, sans affaiblir les assertions. |
| [#480](https://github.com/Rwanbt/unifia/issues/480) | Réactiver les skips applicables, ou justifier chaque exclusion par une preuve de périmètre/environnement. | Recompter au SHA actuel et synchroniser E2E-SKIP-REGISTER / skip baseline ; #736 porte le défaut Review restant. Un skip ne devient jamais pass. |
| [#728](https://github.com/Rwanbt/unifia/pull/728) / [#573](https://github.com/Rwanbt/unifia/issues/573) | Autorité d'artefacts unique : @unifia/artifact-runtime. | Corriger la conformité PR #728, obtenir preuve CI et intégration propriétaire, puis réévaluer #573 à partir du nouveau dev ; ne pas câbler un deuxième stockage. |
| [#117](https://github.com/Rwanbt/unifia/issues/117) / [#575](https://github.com/Rwanbt/unifia/issues/575) | Voice bornée D3 et Windows/Linux/Android D5 restent REQUIRED. | Préparer l'automatisable ; PHYSICAL_TEST_REQUIRED demeure tant que les essais matériels demandés ne sont pas exécutés. Pas de GO PROD par simulation. |

## Consignes d'autonomie et d'autorité

- Les décisions ci-dessus sont **DECIDED**, non NEEDS_OWNER. Une contradiction nouvelle doit être prouvée et soumise comme amendement, pas être reposée comme la même question.
- Le gel RC-1 porte sur les nouvelles fonctionnalités. Une correction d'un défaut réel ou du harnais de test d'une surface livrée demeure permise.
- Main, dev, dev_auto sont les trois branches permanentes (#597) ; préserver les contributions des branches temporaires avant nettoyage.
- Continuer les tâches indépendantes lorsqu'un lot est en attente de fusion, de runner ou d'appareil. Ne jamais déclarer un gate vert sans preuve au SHA exact.
- Respecter D9 : aucune promotion dev vers main, aucun tag, signature ou publication automatisée. Les changements aux workflows et leurs fusions suivent les réserves propriétaires.
- Les critères historiques remplacés restent documentés comme reportés, jamais comme satisfaits. Les obligations post-RC-1 conservent leurs issues.

## Nouveaux arbitrages ratifiés — 16 octobre 2026, série A/B/C

**A — Contrôles grisés (#548, option A `aria-disabled`).** Les contrôles de fonctions différées restent visibles, grisés, atteignables au clavier et annoncés indisponibles aux lecteurs d'écran. Ils ne doivent être activables ni au pointeur, ni au clavier, ni par événement synthétique ni par chemin alternatif vers une mutation, et doivent conserver un focus visible. `aria-disabled` ne bloque **pas** les événements à lui seul : vérifier les gardes de handlers et l'absence d'effet secondaire ; conserver l'usage des primitives existantes et l'aspect UI validé. L'indication d'indisponibilité accessible ne doit pas inventer une promesse « Bientôt ». Les `disabled` natifs déjà corrects pour des conditions temporaires ou autres surfaces restent autorisés : pas de conversion mécanique ni de suppression des labels. Classer chaque contrôle réellement non branché `DISABLED_VISIBLE` et lier son issue #675–#682. **Option B et C écartées comme politique globale** pour ces contrôles.

**B — Nix (workflow `nix-hashes.yml`).** Garder la capacité Nix et ses références déterministes, mais **interdire l'écriture automatique directe sur `dev` / toute branche protégée**. Séparer explicitement collecte des hashes sur runners natifs Linux (x86_64/aarch64 ; Darwin aussi pour les artefacts maintenus) et adoption des hashes : upload d'artefacts avec provenance (SHA source + lockfile, OS/arch, versions d'outils), vérification d'une seconde exécution indépendante, révision humaine puis PR dédiée vers `dev`, CI de `nix build` au SHA retenu. Le workflow actuel comporte `permissions: contents: write` et un `git push origin HEAD:` : ne **pas** le réactiver tel quel. Les changements `.github/**` et leur fusion restent réservés au propriétaire. Linux (D5) reste inclus ; la couverture Nix ne peut être déclarée verte tant que les hashes actuels sont périmés et qu'aucune reconstruction propre ne passe. **Décision acquise ; implémentation et preuves en attente.**

**C — Version cible première release stable : `v1.5.0`.** Cette version est un **objectif de publication validé**, **pas** une autorisation de créer un tag, de signer ou de publier. `VERSION` et desktop indiquent actuellement `1.3.15`, Android `0.1.0` ; plusieurs tags `v1.3.x` et `v1.4.0` existent déjà, tandis que `v1.5.0` était absent lors de la vérification du 16/10. Préparer un lot isolé d'alignement des versions et métadonnées réellement distribuées (CLI, desktop, Android, canal update, provenance), la documentation de migration/upgrade et un dry-run sans signature de publication ; tester le résolveur de version et recontrôler l'absence de collision de tag **au moment de la release**. Ne jamais modifier `VERSION` ni produire `v1.5.0` dans le simple cadre de la ratification documentaire. Seul le propriétaire décide la promotion après tous les gates et essais physiques D9.

**Pour les agents :** A, B et C sont `DECIDED`, pas `NEEDS_OWNER`. Les tâches d'implémentation et de certification restent ouvertes, indépendantes et à traiter selon #581/#597. Ces décisions ne changent ni les règles des fusions de PR ni le périmètre Browser/Voice.

## Arbitrages hors du présent lot — preuve ou actes encore nécessaires

- Fusions de PR, matériels physiques, tests et qualification release exigent les preuves et actions propriétaire prévues, mais **pas** de nouveau vote sur les choix A/B/C.
- Les autres questions d'architecture, de sécurité ou de périmètre non énumérées ici ne reçoivent aucune approbation implicite.

L'absence de décision ici n'autorise pas l'agent à changer une politique de sécurité, de diffusion, de plateforme ou d'architecture.
