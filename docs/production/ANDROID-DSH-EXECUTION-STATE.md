<!-- SPDX-License-Identifier: MIT -->
# État d'exécution — parité Android avec DSH

Point de reprise de ce chantier. Une session qui reprend part d'ici, du dépôt et des PR,
jamais de la conversation. Le point d'entrée général reste
[EXECUTION-STATE.md](EXECUTION-STATE.md).

Mise à jour : 2026-10-22 (section « État au 2026-10-22 » ci-dessous ; le reste date du 21).

## État au 2026-10-22

Architecture tranchée : [ADR-097](../adr/ADR-097-android-toolchain-runtime.md) (Alpine conservé, gestionnaire
vérifié sur l'appareil). Toutes fusionnées dans `dev` (2026-10-22), chacune à son SHA de tête après CI verte :

| PR | Branche | Contenu |
|---|---|---|
| #847 | `feat/android-toolchain-apk-verify` (base `dev`) | lecture sûre des `.apk` |
| #848 | `feat/android-toolchain-apk-index` | index signé, clés épinglées, chaîne de vérification, résolveur |
| #849 | `feat/android-toolchain-transaction` | transactions journalisées, reprise, verrou |
| #850 | `feat/android-toolchain-manager` | install, update, remove, rollback, quotas, cache |
| #851 | `feat/android-toolchain-cli` | `unifia toolchain`, Network Authority, e2e arm64 (`.github/**` : D11) |
| #853 | `feat/android-toolchain-agent-tool` | outil agent `toolchain` (Android seulement, permission) |
| #855 | `feat/android-toolchain-wrapper-refresh` | wrappers régénérés après chaque installation, sans redémarrage |
| #856 | `feat/android-server-reaper` | reaper du serveur : PID, heure de démarrage, boot et UID vérifiés |
| #857 | `feat/android-toolchain-p2-p3` | e2e P2/P3 ; création des répertoires vides des paquets |
| #852 | `fix/android-rootfs-integrity` (base `dev`) | SHA-256 du minirootfs, gcc conservé, contrôle des compilateurs |

Flux complet SOURCE → DOWNLOAD → VERIFY → INSTALL → EXECUTE → UPDATE → ROLLBACK → REMOVE :
**réussi** sur Linux arm64 réel, run 39699068054 au SHA `cf9b3aa03f63ee2db673438541d1aad2a2f538bb`
(rapport en artefact `toolchain-e2e-report`). Exécution par le loader musl du rootfs (même
mécanisme que `libmusl_linker.so`), compilations en chroot. **Aucune exécution sur téléphone.**

| Outil | Installé | Exécuté (arm64 CI) | Testé sur Android | Statut |
|---|---|---|---|---|
| Python 3.12 + pip | oui | oui : `--version`, script ssl/sqlite, `pip --version` | non | PARTIELLE (appareil) |
| Node 20/22 + npm | oui | oui : `node -e`, `npm --version` | non | PARTIELLE (appareil) |
| Bun | fourni par l'APK (Bionic), hors gestionnaire | — | non vérifié ici | NON_VÉRIFIABLE |
| Git | oui | oui : `init`, `commit`, `log` | non | PARTIELLE (appareil) |
| SSH (openssh-client), curl | oui | oui : `ssh -V`, `curl --version` | non | PARTIELLE (appareil) |
| C/C++ (gcc, g++), Clang/LLVM | oui | oui : compilation et exécution | non | PARTIELLE (appareil) |
| Rust / Cargo | oui | oui : `cargo new` + `cargo run` | non | PARTIELLE (appareil) |
| Go | oui | oui en chroot (`go build` + exécution) ; impossible par le loader (ELF statique) | non | **BLOCKED** sur téléphone (ADR-097 §6) |
| Make, CMake | oui | oui : projet CMake compilé par `make` puis exécuté | non | PARTIELLE (appareil) |
| JDK 21, Maven, Gradle | oui | oui : `javac` + `java`, `mvn -v`, build Gradle | non | PARTIELLE (appareil) |
| Kotlin | pas de paquet Alpine 3.21 stable : compilateur via le plugin Gradle officiel `kotlin("jvm")` 2.0.21 | oui : `gradle run` | non | PARTIELLE (appareil) |
| Ruby 3.3, PHP 8.3, Lua 5.4, Perl 5.40, SQLite 3.48 | oui | oui | non | PARTIELLE (appareil) |
| Docker (P3) | `docker-cli` | oui, en **client** d'un démon hors rootfs (`docker version` → démon 28.0.4) | non | PARTIELLE ; jamais présenté comme démon local (root requis) |
| PRoot (P3) | absent d'Alpine 3.21 stable (seulement `testing`) | — | — | ABSENTE |

Défauts trouvés par les runs réels et corrigés (test rouge d'abord) : longueurs pax en
caractères (#847), cache indexé par version alors qu'Alpine reconstruit sans changer de
version (#850), demandes par nom fourni perdues à la mise à jour (#850). Limite assumée : les
scripts d'installation apk ne sont pas exécutés (busybox ne crée pas ses liens ; `coreutils-env`
fournit `/usr/bin/env`).

Hash Alpine résolu : minirootfs 3.21.3 aarch64 `ead8a4b3…ff261ea`, publié en `.sha256` et
signé (`.asc`, clé `0482D84022F52DF1C4E7CD43293ACD0907D9495A`) → #852.

PR #826 (validation de manifest à artefacts épinglés) n'est pas utilisée par le chemin
Alpine, qui lit l'index signé ; elle reste utile pour des artefacts hors Alpine. À trancher
par le propriétaire : la garder pour ces artefacts ou la fermer.

Reste à faire, dans l'ordre : régénérer les wrappers natifs après une installation (Rust,
sans redémarrage) ; route serveur et UI ; supervision des processus (orphelins, avec
protection contre la réutilisation de PID) ; build APK arm64 et run sur téléphone ; réduction
du rootfs embarqué.

## Identité du chantier

| Élément | Valeur |
|---|---|
| Branche | `feat/android-native-runtime-dsh-parity` |
| Base | `dev` @ `2322abe92ebbe926ce75f53172ea1b68f80275b2` (rebasée le 2026-10-21) |
| Cible des PR | `dev` (jamais `main` ni `dev_auto` directement) |
| Source de référence | `Soodok/Deepseek-Harness-Local-Android` @ `67e0e5fd2bb96f5503b142f258dfe3b7ecd23dd6` |
| Documents | [plan](ANDROID-DSH-PARITY-PLAN.md) · [matrice](ANDROID-DSH-PARITY-MATRIX.md) |
| PR | #825 (documentation) · #826 (code lot C1), toutes deux vers `dev` |

## Invariant de branches

| Relation | Résultat (2026-10-21) |
|---|---|
| `main ⊂ dev` | vrai |
| `main ⊂ dev_auto` | vrai |
| `dev ⊂ dev_auto` | **faux** : 18 commits de chaque côté |

Le document général affirmait `dev ⊂ dev_auto` au 14 octobre. Ce n'est plus vrai. La
resynchronisation de `dev_auto` relève du propriétaire.

## Ce qui est fait

- [x] Clone superficiel de `Rwanbt/unifia` et de DSH ; SHA épinglés.
- [x] Lecture de `CLAUDE.md`, `AGENTS.md`, `docs/production/EXECUTION-STATE.md`,
      `docs/production/CAPABILITY-MATRIX.md`, `docs/production/PLATFORM-SUPPORT.md`,
      `docs/adr/`, `.github/pull_request_template.md`.
- [x] Audit du runtime Alpine, du script de rootfs, de `toolchain.rs`, de `extraction.rs`,
      de `LlamaService.kt`, de `PtyServerRespawnPolicy.kt`, du module de permissions.
- [x] Audit du gestionnaire d'extensions DSH (`ExtensionManager.kt`, `RuntimeInstaller.kt`,
      `Privilege.kt`, `OrphanReaper.kt`, `catalog.json`).
- [x] Matrice rédigée : chaque ligne a un statut et une preuve (chemin:ligne).
- [x] Tests réels exécutés : `git/android-launcher` 5/5 ; `permission` 111/111 ;
      `notifications` 2/2 (avec `--preload ./happydom.ts`).
- [x] Défauts démontrés consignés (matrice, section finale).
- [x] Lot C1 (PR #826) : `packages/unifia/src/toolchain/catalog.ts` + 19 tests RED → GREEN,
      règle de licence ADR-027 §8 comprise ; typecheck (`tsgo --noEmit`) et biome passent.

## Ce qui reste

| Priorité | Action | Bloquée par |
|---|---|---|
| 1 | Lot C1 faite (validation du manifest) ; **intégration à l'installeur** à concevoir après C2 | — |
| 2 | ~~Lot C2~~ : fait dans #852 (hash résolu le 22) ; versions consignées plutôt qu'épinglées (ADR-097) | — |
| 3 | Lot E : nettoyage des processus orphelins (Rust, testable host) | — (décision prise : ADR-097) |
| 4 | ~~ADR d'architecture~~ (ADR-097) ; benchmark sur appareil | Appareil Android du propriétaire |
| 5 | ~~Lots C3 à C5~~ (#847 à #851, #853) ; C6 : wrappers, route, UI | — |

## Blocages connus

- **Pas d'Android SDK/NDK, pas d'adb, pas de GPU, pas de qemu** dans ce cloud : aucun APK,
  aucun test instrumenté, aucun benchmark.
- ~~**CDN Alpine refusé**~~ : levé le 2026-10-22 (session locale avec accès au CDN).
- **Libs GTK/WebKit absentes** : tests host Rust du runtime non exécutés ici ; la CI les lance.
- **Invariant de branches rompu** (ci-dessus).
- **`.github/**`** : un agent peut le proposer mais pas le fusionner (D11). Le workflow e2e de #851 attend donc le propriétaire.

## Commandes de reprise

```sh
cd /home/user/unifia
git fetch origin +refs/heads/dev:refs/remotes/origin/dev +refs/heads/dev_auto:refs/remotes/origin/dev_auto +refs/heads/main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main origin/dev && echo "main ⊂ dev"
git merge-base --is-ancestor origin/dev origin/dev_auto && echo "dev ⊂ dev_auto"

export PATH="$HOME/.bun-1.3.11/bin:$PATH"   # bun 1.3.11 épinglé (package.json)
cd packages/unifia
bun test test/git/android-launcher.test.ts --timeout 30000
bun test test/permission --timeout 30000
bun test test/toolchain --timeout 30000     # C1 : 15 pass attendus
bun run typecheck
cd ../mobile && bun test --max-concurrency=1 --preload ./happydom.ts src/notifications.test.ts
```

## Journal

| Date | Étape | SHA | Preuve |
|---|---|---|---|
| 2026-10-21 | Branche créée depuis `dev` | `8940d8b6a` | `git checkout -b` |
| 2026-10-21 | Typecheck turbo au pre-push (59 packages en portée) | — | 48 tâches sur 48 réussies |
| 2026-10-21 | PR #825 ouverte, CI : `merge-and-size` en échec (520 > 400 lignes, docs comprises) | — | `check-pr-size.sh` |
| 2026-10-21 | Découpe : docs seuls (#825) et code seul (#826) | `ff241a6cc`, `3ec9d69c6` (#826) | 330 et 216 lignes |
| 2026-10-21 | Lot C1 : validation du manifest, RED → GREEN | `ff241a6cc` | 15/15 |
| 2026-10-21 | Règle de licence ADR-027 §8, RED → GREEN | `3ec9d69c6` | 19/19, typecheck et biome OK |
| 2026-10-21 | Ce journal mis à jour | voir `git log` | — |

### P2/P3 (2026-10-22)

e2e P2/P3 verte : run 39739935404 au SHA `2d30e414d6af87b53b1e426238e6a7af0b4211ee` (`script/toolchain-e2e-p2.sh`).
Limite assumée et mesurée : le gestionnaire n'exécute aucun script apk. Conséquences constatées :
pas de liens busybox (`ls`, `xargs`, `run-parts` : installer `coreutils`, `findutils`, `run-parts`),
pas de liens `/usr/bin/javac` (JDK appelé par son chemin), pas de truststore Java tant que le
trigger `update-ca-certificates` n'a pas tourné (l'e2e le lance explicitement). Le rootfs de l'APK,
construit avec apk, a déjà ces éléments ; un rootfs minimal devra traiter ces triggers avant d'être réduit.
