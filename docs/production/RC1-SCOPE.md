<!-- SPDX-License-Identifier: MIT -->
# Périmètre des capacités — Release 1 (RC-1)

**Document de travail pour #548.** Source de décision : `docs/autonomy/rc0/DECISIONS.md`,
ratification du 13 octobre 2026 dans #548 et ordre d'exécution de l'epic #581.
Cette matrice définit le **périmètre demandé**, pas l'état livré ni un GO release.
En cas d'écart, la décision du propriétaire et #581 priment. La source v1.5.4
reste normative pour le programme global, sans devenir un gate RC-1.

## Vocabulaire (une seule classification par surface de release)

- `REQUIRED` : attendu en RC-1 ; sans point d'entrée livré **et** preuve
  fonctionnelle sur un SHA candidat, le gate reste **ouvert**.
- `DEFERRED_HIDDEN` : réalisé après RC-1 ; entrée UI masquée. Du code présent,
  une route en 503 ou un composant non monté ne constituent pas une livraison.
- `DISABLED_VISIBLE` : contrôle « SOON » visible mais désactivé et clairement
  annoncé indisponible ; aucune mutation, navigation trompeuse ou succès simulé.
- `NOT_IN_RC1` : plateforme ou capacité hors périmètre de cette release ;
  aucune promesse de disponibilité ni gate bloquant RC-1.

**Règle de preuve :** ne jamais déduire `INTEGRATED` de `IMPLEMENTED`.
Chaque ligne `REQUIRED` doit être démontrée au point d'entrée distribué
(Windows, Linux ou Android selon la surface) avec tests/CI liés au **head SHA**
de la PR, puis preuves physiques lorsque nécessaires. Une PR ouverte, un
`test.fixme`, un test ignoré ou un statut historique ne valent pas certification.

**Aucune exclusion implicite :** une ancienne « divergence acceptée » RC-0 ou une
absence de preuve ne vaut jamais `NOT_IN_RC1`. Seule une décision explicite du
propriétaire classe une capacité ou une plateforme hors release 1.

**Changement de périmètre :** modifier la classe RC-1 d'une surface passe par une
issue, un ADR ou une décision de release, jamais par un simple changement d'interface.

## Décisions acquises et suivi

**Priorité RC-1 :** rendre fonctionnel tout ce qui est déjà intégré, sans ajouter de nouvelles fonctionnalités **sauf exception spécifique #571 ratifiée le 16/10/2026** : Computer Use et sandbox nécessaires deviennent **REQUIRED** et ne sont pas livrés tant que sécurité, intégration réelle et qualification ne sont pas prouvées. Aucun autre package différé ne devient automatiquement REQUIRED.

**Complément propriétaire du 16/10 (PR #747 ; fusion nécessaire pour l'intégrer à `dev`) :** (A) contrôles grisés en `aria-disabled` mais strictement inertes, sans action ni effet, labels et clavier préservés ; (B) hashes Nix reconstruits et validés en CI sans poussée automatique dans `dev` (#748) ; (C) première version stable cible `v1.5.0` après alignement des métadonnées et gates, jamais un tag automatique. #733 réduit le client Knowledge, #588 garde le diff desktop seul dans RC-1, #552/#729 exigent de vrais tests Design. Voir [registre du 16/10](../autonomy/rc0/OWNER-ARBITRATIONS-2026-10-16.md). Ces choix **ne** constituent **pas** des preuves d'implémentation ou de qualification.

| Surface / politique | Classe RC-1 | Décision / issue | Preuve encore requise |
|---|---|---|---|
| Shell, Chat et navigation réels | `REQUIRED` | D6 ; #116, #551 | Parcours rendu + gestes/clavier + CI au SHA candidat |
| Accueil : résumé d'état (`home.glance`) | `REQUIRED` | #550 ; #592 fusionnée (`e69c85fc0`). Décision du 14/10 : garder | Données réelles (projets, modes, état serveur) + E2E verts au SHA candidat |
| Barre d'onglets de l'espace de travail (`shell.workspace-tabs`) | `NOT_IN_RC1` | #551 ; #591 fusionnée (`0711bfd64`). Décision du 14/10 : hors version 1, plus nécessaire depuis la refonte de l'interface | Retrait de l'écran à planifier dans une PR dédiée ; aucune barre visible sans fonction réelle |
| Vue des modifications de code (`code.diff`), ordinateur | `REQUIRED` | #588 ; #663 fusionnée (`8ec95f3ed`). Décision du 14/10 : garder | Diff canonique réellement atteint + E2E verts au SHA candidat |
| Vue des modifications de code, compact et mobile | `NOT_IN_RC1` | #588. Décision du 14/10 : reportée après la version 1 | Aucun second état artificiel ; issue de suivi post-RC1 |
| Code : éditeur, diagnostics, Git, actions atteignables | `REQUIRED` | D4 ; #96, #559 | Tests de flux sur le binaire livré ; absence de comportement factice |
| Code Lens et suggestions inline (Inline AI) | `NOT_IN_RC1` | #96. Décision du 14/10 : hors version 1 | Indisponibilité déclarée ; aucun contrôle ni effet factice |
| Work / Kanban / actions effectives | `REQUIRED` | D7 ; #580, #564 | Mutations réelles, autorisations et E2E sur point d'entrée |
| Design : fonctionnalité et garde anti-régression | `REQUIRED` | D6 ; #552, PR #583 déjà ouverte | Valider les régressions démontrées ; ne pas relancer une refonte générale de parité |
| Mémoire, Automate, capacités et connexions effectivement visibles | `REQUIRED` pour les contrôles actifs | #493, #555–#563, #564, #574 | Chaque action active adossée à une autorité réelle ; [matrice des commandes distantes](REMOTE-CONTROL-RC1.md) ; inventaire contrôle par contrôle restant à établir |
| Browser : interface et livraison utilisateur | `DEFERRED_HIDDEN` | D2 ; #118, #279, #554 (train suivant) | Vérifier l'absence d'accès UI en RC-1 ; travaux de fondation possibles séparément |
| Computer Use / sandbox sécurité, point d'entrée et effets privilégiés | `REQUIRED` (exception 16/10, choix 8B) | #571 ; PR #712 = garde fail-closed provisoire | Broker et sandbox réellement intégrés ; approbations/permissions, isolation, négatifs, E2E, qualification Windows/Linux/Android selon capacité annoncée ; aucun GO PROD sans preuve et aucune exclusion tacite |
| Voice Live — périmètre borné D3 | `REQUIRED` | D3 ; #117 | CI Voice + qualification physique Android et Windows ; pas de claim pour Pocket Android, AEC/NS/AGC ou full-duplex différés |
| Contrôles grisés sans capacité active (ex-« SOON ») | `DISABLED_VISIBLE` | Décisions du 06/10 et du 14/10 : grisés, non cliquables tant que la fonction n'est pas implémentée et raccordée ; aucune mention « bientôt » | Inventaire exhaustif + tests « désactivé, aucun effet » ; issue identifiée pour chaque fonction |
| Chat et sessions : vue côte à côte | `NOT_IN_RC1` | Idée post-RC1 (issue de suivi) | Hors version 1 |
| Windows, Linux et Android | `REQUIRED` | D5 ; #575, #576 | Installation, parcours et qualification propres à chaque plateforme |
| macOS, iOS, Web/PWA | `NOT_IN_RC1` | D5 ; #575, programme global #598 | Exclusion explicite dans les notes de release et la matrice plateforme |
| Promotion `dev→main`, tags, signature et publication | `NOT_IN_RC1` **pour les agents** | D9 ; #576–#578 | Actions réservées au propriétaire ; les agents ne font que préparer les preuves/dry-runs non publiants |

Les statuts décidés ne ferment aucune issue et ne retirent aucun engagement du
programme global. Décisions du propriétaire du 14/10 : Code Lens et Inline AI hors version 1 ; accueil gardé ; barre d'onglets de workspace hors version 1 ; vue des modifications gardée sur ordinateur, compact et mobile reporté ; contrôles grisés sans mention « bientôt » ; vue côte à côte hors version 1. **#548 reste ouvert** : l'inventaire complet des contrôles (gate ci-dessous) est encore à faire.

## Contrôles et tests encore sans disposition complète

| Constat | Traitement obligatoire |
|---|---|
| Trois `fixme` du groupe B sans cause documentée : model picker, historique prompt, session review | Diagnostiquer sous #480 ; aucune exclusion silencieuse |
| 28 exclusions CI du groupe A et les exclusions conditionnelles du groupe C | #480 + `E2E-SKIP-REGISTER.md` : réactiver ou justifier avec preuve |
| Destinations Settings v110 non câblées (`#98`) | Conserver l'absence explicite ; ne pas fabriquer un écran. Pour tout nouvel écran, produire un contrat runtime et une issue de suivi |
| Contrôles actifs, masqués, `SOON`, grisés et routes en 503 non encore recensés exhaustivement | Établir un inventaire `UI → action → API/autorité → preuve → issue` avant validation de #548 / #564 |

## Gate de fermeture de #548

- [x] Le propriétaire a validé les dispositions du 14/10 (ci-dessus).
- [ ] Inventaire exhaustif des contrôles v110 actifs, absents et « SOON » ;
      chaque différé possède une issue de train suivant.
- [ ] Synchronisation de `CAPABILITY-MATRIX.md`, `GAP-REGISTER.md`,
      `M3-ACCEPTANCE-MATRIX.md` et `E2E-SKIP-REGISTER.md`.
- [ ] Preuve sur le **head SHA** de la PR concernée ; preuves manuelles et
      plateformes mentionnées comme non vérifiées lorsqu'elles manquent.

**Aucune preuve produit n'est créée par ce document.**
