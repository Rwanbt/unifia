<!-- SPDX-License-Identifier: MIT -->
# Plan de parité Android — Unifia intègre les capacités utiles de DSH

Objet : combler les écarts réels entre Unifia et Deepseek-Harness-Local-Android (DSH) sur
le runtime Android, sans remplacer OpenCode, Tauri, Voice, GPU ni les fonctionnalités
existantes. Chaque capacité est classée d'après le code (voir la matrice). Ce plan ne
déclare rien « production ready » : la qualification physique n'est pas faite.

Documents liés : [matrice](ANDROID-DSH-PARITY-MATRIX.md) · [état d'exécution](ANDROID-DSH-EXECUTION-STATE.md)

## Périmètre et gouvernance

- Branche de travail : `feat/android-native-runtime-dsh-parity`, créée depuis `dev`.
- Les PR vont vers `dev`. Aucune fusion, aucun tag, aucune publication sans autorisation du
  propriétaire (D9). Les changements de `.github/**` reviennent au propriétaire (D11) :
  ce plan n'en touche aucun.
- Ce chantier n'est pas dans la file `#581`. Il est confié directement par le propriétaire
  via la commande `/goal`. La règle « uniquement la file #581 ou ce que le propriétaire
  assigne » est donc respectée ; à noter pour la revue.
- Chaque PR suit `.github/pull_request_template.md` : sans les cinq titres et les cases
  cochées, `compliance-close` la ferme après 2 heures.
- Le cloud n'a ni Android SDK/NDK, ni adb, ni GPU, ni qemu, et le CDN Alpine est refusé
  par le proxy. Tout ce qui exige un appareil reste **NON_VÉRIFIABLE** ici.

## Décision d'architecture (proposition, non ratifiée)

Le choix Alpine, Bionic ou hybride se tranche par ADR et benchmark, pas par principe. Le
benchmark exige un appareil : il ne peut pas être fait ici. Je propose donc, sans la figer :

| Option | Pour | Contre |
|---|---|---|
| **A. Garder Alpine musl (état actuel)** | Déjà intégré ; 64 paquets présents ; git testé en host (5/5) ; pas de réécriture | Rootfs de ~80 Mo ; versions non épinglées ; hacks LD_PRELOAD ; contradiction gcc ; non vérifié sur appareil |
| **B. Migrer vers Bionic / Termux (DSH)** | Petit APK ; dépôt indexé avec SHA-256 par paquet ; installation à la demande | Réécriture majeure ; chemins Termux à relocaliser ; patchs ELF ; aucune preuve sur Unifia |
| **C. Hybride : Alpine comme seul rootfs, couche manifest au-dessus** | Réutilise apk-tools et ses signatures ; pas de second gestionnaire ; migration incrémentale | apk à l'exécution a déjà échoué sous proot ; à mesurer sur appareil |

**Recommandation : C**, sous réserve d'un benchmark sur appareil par le propriétaire. Ce
choix évite le gestionnaire concurrent que la mission interdit. Le lot C1 ci-dessous ne
dépend pas de la décision : il vaut pour A comme pour C.

## Lots et état

### Lot A — Audit (fait)

Matrice et état d'exécution rédigés, SHA épinglés, invariant de branches vérifié. Défauts
démontrés listés dans la matrice (intégrité du rootfs, contradiction gcc, versions non
épinglées, invariant rompu).

### Lot B — Runtime autonome (non démarré hors preuves)

- Mesures d'ABI, de dépendances natives et de stockage : **NON_VÉRIFIABLE** ici.
- Prochaine action : ADR de choix d'architecture (option C recommandée) avec les mesures
  à faire sur appareil. Document à rédiger, pas à faire ratifier par ce cloud.

### Lot C — Toolchain Manager (priorité)

Contraintes ADR déjà décidées, à respecter par tout lot C :
- **ADR-027** (DECIDED) : zod pour la validation, `bun test`, biome, Conventional Commits,
  PR ≤ 400 lignes, et **licences permissives seulement** (MIT, Apache-2.0, BSD-2/3, ISC) ;
  un copyleft exige une exception documentée par ADR.
- **ADR-023** : tout téléchargement passe par la Network Authority. Un chemin direct est un NO-GO.
- **ADR-024** : composants tiers non fiables par défaut ; environnement filtré pour les processus.

| Étape | Contenu | Où | Statut |
|---|---|---|---|
| **C1** | Validation pure du manifest : https sur hôte de confiance, SHA-256 obligatoire, version exacte, binaires sûrs, clés inconnues refusées, dépendances connues et acycliques, binaires uniques, fermeture ordonnée, licence ADR-027 | `packages/unifia/src/toolchain/catalog.ts` + tests | **PR #826** (19 tests, RED → GREEN) |
| C2 | Corriger le rootfs : SHA-256 épinglé du tarball Alpine, versions de paquets épinglées, vérification de `cc`/`c++` après strip, suppression de `\|\| true` | `packages/mobile/scripts/build-alpine-rootfs.sh` | Bloqué : besoin du hash officiel Alpine et d'un build chroot |
| C3 | Installation à la demande via apk dans le rootfs, avec vérification des signatures apk | `packages/mobile/src-tauri/src/runtime/` | Après C2 et décision C |
| C4 | Atomicité : répertoire temporaire puis renommage, verrou par outil, reprise bornée | Rust, tests host | Après C3 |
| C5 | Rollback, nettoyage des caches, quotas disque | Rust | Après C4 |
| C6 | Interface d'état et d'installation | `packages/app` | Après C3 ; respecter l'UI existante |

### Lot D — Sécurité

- Déjà présent et validé en host : permissions par outil et par session (111 tests).
- Ouvert : contrôle des chemins (audit détaillé), SSRF (une seule protection connue, dans
  `http-connector.ts`), révocation atomique (non audité).
- Shizuku : **ne pas ajouter** sans modèle de consentement explicite. Root : reste désactivé,
  aucun code d'élévation n'est à ajouter.
- Accessibilité et injection d'interface : **ne pas ajouter** (règle de la mission).

### Lot E — Résilience

- Ouvert : nettoyage des processus orphelins (absent ; DSH a `OrphanReaper.kt` et
  `PR_SET_PDEATHSIG`). Candidat à une PR Rust testable sur host.
- Non vérifiable ici : foreground service, Doze, reprise après crash réelle.

### Lot F — UX

- Notifications : validées en host (2/2).
- Ouvert : prévisualisation HTTP loopback sécurisée (absente), terminal mobile (non vérifié).
- Voice : **préservé**, aucune modification.

### Lot G — Qualification

- Ajouté dans cette branche : tests TypeScript du manifest.
- Impossible ici : `androidTest`, build APK, matrice ABI/API, budget CPU/RAM/disque,
  tests host Rust (dépendances GTK/WebKit absentes). Ils passent par la CI (`mobile-runtime-tests.yml`,
  `android.yml`) ou par le propriétaire.

### Lot H — Qualification finale et intégration

- Typecheck, lint et tests des packages touchés : à exécuter au SHA de la PR.
- Revue des licences et des vulnérabilités : à faire par composant avant toute release.
- GO / NO-GO : **NO-GO** pour une release Android aujourd'hui. Motifs : défauts démontrés
  dans le rootfs, aucune preuve sur appareil, aucun test instrumenté.

## PR (≤ 400 lignes modifiées chacune)

Le contrôle `scripts/check-pr-size.sh` compte **toutes** les lignes modifiées, documents compris
(hors lockfiles et répertoires générés). Une PR qui mêle docs et code dépasse donc vite la limite :
la première tentative a donné 520 lignes et échoué en CI (`merge-and-size`). D'où la découpe.

1. **#825** — `docs/production/` seul : 330 lignes.
2. **#826** — C1 et règle de licence : 216 lignes.
3. Suivantes, après décision propriétaire : C2 (rootfs), orphelins (E), puis C3 à C6.

## Ce qui reste bloqué (demande au propriétaire)

- Fournir le SHA-256 officiel du tarball Alpine 3.21.3 aarch64 (publié à côté sur
  dl-cdn.alpinelinux.org, inaccessible depuis le cloud).
- Trancher l'invariant `dev ⊂ dev_auto` (divergence de 18 commits de chaque côté).
- Ratifier l'option d'architecture (A, B ou C), après benchmark sur appareil.
- Autoriser ou refuser les changements de `.github/**` nécessaires aux tests Android.
