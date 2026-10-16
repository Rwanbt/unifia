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

## Questions encore ouvertes — aucune approbation implicite

- Accessibilité des contrôles grisés : aria-disabled, disabled strict ou wrapper avec tooltip (#548, CONTROLS-GREYED-RC1.md).
- Sortie Nix et workflow nix-hashes : réactivation et recalcul déterministe ou exclusion formelle du packaging Nix. Linux demeure REQUIRED.
- Version de la première release (O2 dans DECISIONS.md).
- Fusions et qualifications spécifiques qui exigent encore une preuve/revue propriétaire.

L'absence de décision ici n'autorise pas l'agent à changer une politique de sécurité, de diffusion, de plateforme ou d'architecture.
