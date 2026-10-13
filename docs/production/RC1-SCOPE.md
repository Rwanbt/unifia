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

| Surface / politique | Classe RC-1 | Décision / issue | Preuve encore requise |
|---|---|---|---|
| Shell, Chat et navigation réels | `REQUIRED` | D6 ; #116, #551 | Parcours rendu + gestes/clavier + CI au SHA candidat |
| Accueil / `home.glance` déclaré mais absent | `REQUIRED` (écart) | #550 ; PR #592 rouverte le 13/10 | Choix explicite implémenter/retirer, puis données réelles + E2E ; pas de statistiques fictives |
| Onglets de workspace `shell.workspace-tabs` non montés | `REQUIRED` (écart) | #551 ; PR #591 rouverte le 13/10 | Autorité workspace réelle + état rendu + E2E |
| Diff Code compact/mobile `code.diff` | `REQUIRED` (écart) | #588 ; PR #663 (reprise de #590) | Diff canonique réellement atteint + E2E ; aucun second état artificiel |
| Code : éditeur, diagnostics, Git, actions atteignables | `REQUIRED` | D4 ; #96, #559 | Tests de flux sur le binaire livré ; absence de comportement factice |
| Code Lens et suggestions inline non exposés | `NOT_IN_RC1` **proposé, à ratifier** | #96 (critère : livré **ou** explicitement indisponible) | Confirmer la disposition avec le propriétaire ; jamais annoncer la fonctionnalité comme livrée |
| Work / Kanban / actions effectives | `REQUIRED` | D7 ; #580, #564 | Mutations réelles, autorisations et E2E sur point d'entrée |
| Design : fonctionnalité et garde anti-régression | `REQUIRED` | D6 ; #552, PR #583 déjà ouverte | Valider les régressions démontrées ; ne pas relancer une refonte générale de parité |
| Mémoire, Automate, capacités et connexions effectivement visibles | `REQUIRED` pour les contrôles actifs | #493, #555–#563, #564 | Chaque action active adossée à une autorité réelle ; inventaire contrôle par contrôle restant à établir |
| Browser : interface et livraison utilisateur | `DEFERRED_HIDDEN` | D2 ; #118, #279, #554 (train suivant) | Vérifier l'absence d'accès UI en RC-1 ; travaux de fondation possibles séparément |
| Voice Live — périmètre borné D3 | `REQUIRED` | D3 ; #117 | CI Voice + qualification physique Android et Windows ; pas de claim pour Pocket Android, AEC/NS/AGC ou full-duplex différés |
| Contrôles « SOON » sans capacité active | `DISABLED_VISIBLE` | Décision propriétaire 06/10 ; #548 | Inventaire exhaustif + tests disabled/aucun effet ; issue identifiée pour chaque fonctionnalité |
| Windows, Linux et Android | `REQUIRED` | D5 ; #575, #576 | Installation, parcours et qualification propres à chaque plateforme |
| macOS, iOS, Web/PWA | `NOT_IN_RC1` | D5 ; #575, programme global #598 | Exclusion explicite dans les notes de release et la matrice plateforme |
| Promotion `dev→main`, tags, signature et publication | `NOT_IN_RC1` **pour les agents** | D9 ; #576–#578 | Actions réservées au propriétaire ; les agents ne font que préparer les preuves/dry-runs non publiants |

Les statuts proposés ne ferment aucune issue et ne retirent aucun engagement du
programme global. La classification provisoire de Code Lens/Inline AI et le
choix « implémenter ou retirer » des trois contrats v110 attendent une décision
explicite ; **ne pas déclarer #548 terminé avant cette ratification**. Pour ces
trois contrats, #581 liste déjà les PR #592, #591 et #663 comme implémentations
actives (UI03, UI04, UI06).

## Contrôles et tests encore sans disposition complète

| Constat | Traitement obligatoire |
|---|---|
| Trois `fixme` du groupe B sans cause documentée : model picker, historique prompt, session review | Diagnostiquer sous #480 ; aucune exclusion silencieuse |
| 28 exclusions CI du groupe A et les exclusions conditionnelles du groupe C | #480 + `E2E-SKIP-REGISTER.md` : réactiver ou justifier avec preuve |
| Destinations Settings v110 non câblées (`#98`) | Conserver l'absence explicite ; ne pas fabriquer un écran. Pour tout nouvel écran, produire un contrat runtime et une issue de suivi |
| Contrôles actifs, masqués, `SOON`, grisés et routes en 503 non encore recensés exhaustivement | Établir un inventaire `UI → action → API/autorité → preuve → issue` avant validation de #548 / #564 |

## Gate de fermeture de #548

- [ ] Le propriétaire valide les dispositions provisoires ci-dessus, notamment
      #96 et `home.glance` / workspace tabs / `code.diff`.
- [ ] Inventaire exhaustif des contrôles v110 actifs, absents et « SOON » ;
      chaque différé possède une issue de train suivant.
- [ ] Synchronisation de `CAPABILITY-MATRIX.md`, `GAP-REGISTER.md`,
      `M3-ACCEPTANCE-MATRIX.md` et `E2E-SKIP-REGISTER.md`.
- [ ] Preuve sur le **head SHA** de la PR concernée ; preuves manuelles et
      plateformes mentionnées comme non vérifiées lorsqu'elles manquent.

**Aucune preuve produit n'est créée par ce document.**