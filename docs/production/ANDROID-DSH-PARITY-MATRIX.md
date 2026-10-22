<!-- SPDX-License-Identifier: MIT -->
# Matrice de parité Android — Unifia face à DSH

Référence d'audit :

| Dépôt | Branche | SHA audité |
|---|---|---|
| `Rwanbt/unifia` | `main` | `0d9539cad7eb2a8f3058c1e6c30b1faa803a0db8` |
| `Rwanbt/unifia` | `dev` (base de travail) | `8940d8b6ab95373493d14a1c0cf36ff4e6c27c40` |
| `Rwanbt/unifia` | `dev_auto` | `23a613943d287bebf5a5fae85a069a978b7ce1a4` |
| `Soodok/Deepseek-Harness-Local-Android` | `main` | `67e0e5fd2bb96f5503b142f258dfe3b7ecd23dd6` (clone superficiel) |

Invariant `main ⊂ dev ⊂ dev_auto`, vérifié le 2026-10-21 :
`main ⊂ dev` : oui · `main ⊂ dev_auto` : oui · `dev ⊂ dev_auto` : **non** (18 commits
propres à `dev` et 18 propres à `dev_auto`, les branches ont divergé).

## Légende des statuts

- **EXISTANTE_VALIDÉE** : code présent et exécuté avec succès ici (test host au SHA audité).
- **PARTIELLE** : code présent, mais preuve incomplète (non exécuté, ou une partie absente).
- **ABSENTE** : aucune implémentation trouvée dans le code audité.
- **DÉFECTUEUSE** : défaut démontré par lecture du code, ou contradiction interne.
- **NON_VÉRIFIABLE** : nécessite un appareil Android, un GPU, un SDK/NDK ou un accès réseau
  indisponible dans ce cloud. Aucun statut « validé » n'est donné sans exécution réelle.

Colonne « Vérifié ici » : seul ce qui a été exécuté dans cette session est coché comme tel.

## A. Architecture et runtime de base

| Capacité | Statut | Preuve Unifia | Référence DSH | Vérifié ici |
|---|---|---|---|---|
| Runtime Alpine musl pré-construit, extrait au premier lancement | PARTIELLE | `packages/mobile/src-tauri/src/runtime.rs:120-135` (contrôle de présence seulement), `runtime/extraction.rs:19`, `:98` | Runtime Bionic + paquets Termux (`README.md`) | Non (pas d'APK, pas de rootfs) |
| Intégrité du tarball rootfs à la construction | **DÉFECTUEUSE** | `packages/mobile/scripts/build-alpine-rootfs.sh:57-59` : `curl` puis `tar` sans SHA-256 ni signature | `RuntimeInstaller.kt:293-294` vérifie le SHA-256 de l'archive | Lecture seule |
| Versions des paquets du rootfs figées | **DÉFECTUEUSE** | `build-alpine-rootfs.sh:82-101` : `apk add` sans version, 64 paquets | Index Termux versionné, SHA-256 par `.deb` (`ExtensionManager.kt:517`) | Lecture seule |
| Contradiction gcc / compilation native | **DÉFECTUEUSE (probable, à confirmer par build)** | `build-alpine-rootfs.sh:307` supprime `gcc musl-dev` avec `\|\| true` ; `toolchain.rs:73-80` déclare `gcc g++ cc c++` critiques et avertit que « on-device compilation will fail » ; `rust cargo` (ligne 92) relie via `cc` | — | Lecture seule |
| Build du rootfs reproductible | PARTIELLE | `build-alpine-rootfs.sh:7` et `:27-33` : idempotence par âge (< 30 jours), pas de clé de reproductibilité | Pipeline CI `android-build.yml` (non audité) | Non |
| Exécution Bun / bash / rg Bionic natifs | PARTIELLE | `runtime/server.rs`, `libmusl_linker.so` dans `nativeLibraryDir` | Node Bionic (`README.md` : « runtime bionic Node.js ») | Non |
| Choix d'architecture Android documenté par ADR | EXISTANTE (2026-10-22) | [ADR-097](../adr/ADR-097-android-toolchain-runtime.md) : Alpine conservé + gestionnaire vérifié sur l'appareil. Preuve clé : DSH exige `targetSdk = 28` (`app/build.gradle.kts:20-22`), Unifia cible 36 | `app/build.gradle.kts:22` | Oui (lecture des deux dépôts) |

## B. Runtime autonome et outils

| Capacité | Statut | Preuve Unifia | Référence DSH | Vérifié ici |
|---|---|---|---|---|
| OpenCode embarqué (agent, sessions, fichiers) | PARTIELLE | `packages/unifia/src/mobile-entry.ts`, `runtime/server.rs` | Engine Node (`EngineProcess.kt`) | Non |
| Shell / outil bash dans le rootfs | PARTIELLE | `packages/unifia/src/tool/bash.ts` (736 lignes), `runtime/server.rs` (`build_tool_functions`) | `Pty.kt`, `dsh_pty.c` | Non |
| Git | EXISTANTE_VALIDÉE (host) / NON_VÉRIFIABLE (device) | `packages/unifia/src/git/android-launcher.ts` ; `test/git/android-launcher.test.ts` : **5 pass, 0 fail** | Git via catalogue (`catalog.json`, id `git`) | Oui (host) |
| Python, Node/npm, Go, Java, SQLite, curl, wget, SSH, make, cmake | PARTIELLE | Présents dans le rootfs à la construction : `build-alpine-rootfs.sh:82-101` | Catalogue DSH : 21 entrées (`catalog.json`) | Non |
| Rust / Cargo | DÉFECTUEUSE (probable) | `rust cargo` ligne 92, mais voir la contradiction gcc ci-dessus | Catalogue `rust` | Non |
| Plugins et MCP | PARTIELLE | Hérité d'OpenCode, non vérifié sur appareil | `PluginCenter.kt` (npm) | Non |
| Inférence locale GPU (`LlamaService`) | NON_VÉRIFIABLE | `gen/android/.../LlamaService.kt`, `LlamaEngine.kt` ; CLAUDE.md : GPU obligatoire | `LocalModel.kt` | Non (pas de GPU) |
| Chargement ELF / ABI arm64 et x86_64 | PARTIELLE | `packages/mobile/scripts/check-android-runtime.mjs` vérifie la présence des fichiers, pas l'ABI | `scripts/verify-runtime-abi.py` | Non |

## C. Toolchain Manager

| Capacité | Statut | Preuve | Référence DSH | Vérifié ici |
|---|---|---|---|---|
| Installation à la demande depuis l'interface ou l'agent | PARTIELLE | CLI `unifia toolchain` (PR #851) ; outil agent et UI : à faire ; régénération des wrappers natifs après installation : à faire | `ExtensionManager.kt` (1639 lignes), `ExtensionStoreActivity.kt` | CLI oui (Windows, CDN réel) |
| Index de toolchains | EXISTANTE (code) | Index Alpine signé lu en direct, clés épinglées : `toolchain/repository.ts` (PR #848, 21 tests dont un paquet réel signé par Alpine). Pas de liste d'URL figée : Alpine supprime les anciennes versions (404 constaté) | `catalog.json` (21 entrées), index Termux **non signé** (aucune vérification `InRelease`) | Oui (tests) |
| Validation de politique du manifest (https, SHA-256, version exacte, binaires sûrs, dépendances acycliques, licence ADR-027) | ABSENTE → **ajoutée (PR #826)** | `packages/unifia/src/toolchain/catalog.ts` ; `test/toolchain/catalog.test.ts` : 19 pass | — | Oui (tests) |
| Vérification SHA-256 des artefacts à l'installation | EXISTANTE (code) | Signature RSA du contrôle + `C:` de l'index + `datahash` SHA-256 des données extraites : `repository.ts` `verifyPackage` (PR #848) | `ExtensionManager.kt:517` : SHA-256 **sauté** si l'index n'en donne pas | Oui (tests + paquet réel) |
| Téléchargements passant par la Network Authority (ADR-023) | EXISTANTE (code) / NON_VÉRIFIABLE (device) | `toolchain/download.ts` (PR #851) : origine CDN Alpine seule, adresses publiques, redirections refusées. Sur l'appareil, DNS via le proxy de l'app non vérifié | — | Oui (tests) |
| Installation atomique et rollback | EXISTANTE (code) | `transaction.ts` (PR #849) : journal écrit avant tout déplacement, reprise après crash testée ; rollback hors ligne depuis le cache vérifié (`manager.ts`, PR #850) | `ExtensionManager.kt:667` (`renameTo` de dossier temporaire) | Oui (tests) |
| Verrou concurrent | EXISTANTE (code) | Verrou global à pid, repris si le détenteur est mort (`transaction.ts` `acquireLock`) | `ExtensionManager.kt` (verrou par id d'extension) | Oui (tests) |
| Résolution de la fermeture des dépendances | EXISTANTE (code) | `repository.ts` `resolve` : `so:`/`cmd:`, contraintes de version apk ; 77 paquets pour le lot P1 sur l'index v3.21 réel | `ExtensionManager.kt` (fermeture de dépendances) | Oui (index réels) |
| Licences conformes à ADR-027 §8 (permissives, sinon exception ADR) | **DÉFECTUEUSE (probable)** | Le rootfs embarque probablement des composants copyleft (git GPL-2.0, gcc, bash, readline) sans exception documentée. À confirmer par l'APKINDEX, inaccessible ici. Le champ `exception` est imposé par PR #826 | `catalog.json` ne déclare pas de licence | Non |
| Licences par outil | PARTIELLE | `docs/autonomy/LICENSE-AUDIT-UNIFIA.md` (audit global, pas par outil) | Champ `desc` seul | Non |
| Provenance des binaires de release | PARTIELLE | `docs/android-runtime-provenance.md` ; `scripts/android-runtime-provenance.ps1` (Windows) | `verify-runtime-abi.py` | NON_VÉRIFIABLE ici |
| Quotas disque et nettoyage des caches | EXISTANTE (code) | Quota d'octets installés et espace libre vérifiés **avant** téléchargement ; cache réduit à l'état courant + précédent (`manager.ts`, PR #850) | Nettoyage de `cacheDir` après échec (`ExtensionManager.kt`) | Oui (tests) |
| Interface d'état des toolchains | ABSENTE | — | `ExtensionStoreActivity.kt` | Non |

## D. Sécurité

| Capacité | Statut | Preuve Unifia | Référence DSH | Vérifié ici |
|---|---|---|---|---|
| Permissions par outil et par session | EXISTANTE_VALIDÉE (host) | `packages/unifia/src/permission/` ; `test/permission/` : **111 pass, 0 fail** | — | Oui |
| Contrôle des chemins | PARTIELLE | Non audité en profondeur ici | — | Non |
| Secrets broker (bearer IPC séparé de la clé de chiffrement) | EXISTANTE_VALIDÉE (tests décrits, non exécutés ici) | `runtime/bearer.rs`, 7 tests ; `runtime/README.md` | `CredentialProbe.kt` | Non (cargo + libs Tauri absents) |
| Protection SSRF | PARTIELLE | Une seule occurrence : `packages/unifia/src/model-intelligence/connectors/http-connector.ts` | — | Non |
| Root désactivé par défaut | EXISTANTE (absence conforme) | Aucune élévation `su` dans `gen/android` ni `src-tauri/src` | `Privilege.kt:58-62` : mode NORMAL par défaut, ROOT optionnel | Lecture |
| Shizuku | ABSENTE | Aucune occurrence | `Privilege.kt`, `ShizukuHttpBridge.kt` | Oui |
| Accessibilité / injection d'interface | ABSENTE (conforme : aucun ajout sans consentement) | Aucune occurrence | `DshAccessibilityService.kt`, `ScreenOcr.kt` | Oui |
| Révocation atomique | NON_VÉRIFIABLE | Non audité en détail | — | Non |

## E. Résilience

| Capacité | Statut | Preuve Unifia | Référence DSH | Vérifié ici |
|---|---|---|---|---|
| Service au premier plan conforme (type déclaré, API 34+) | EXISTANTE (code) / NON_VÉRIFIABLE (device) | `LlamaService.kt:31-33`, `:164` (`startForeground` avec type) | `EngineService.kt` | Non |
| Supervision bornée du serveur PTY | EXISTANTE (code) | `PtyServerRespawnPolicy.kt` (plafond de 5 tentatives) ; test Kotlin `PtyServerRespawnPolicyTest.kt` non exécuté (pas de Gradle/SDK) | `EngineSupervisor.kt` | Non |
| Nettoyage des processus orphelins | **ABSENTE** | Seuls des commentaires : `runtime/server.rs:40`, `:150`, `:554` | `OrphanReaper.kt:36` ; `PR_SET_PDEATHSIG` dans `dsh_pty.c` | Oui (recherche) |
| Reprise de session après crash | PARTIELLE | Stockage SQLite (drizzle) hérité ; reprise après redémarrage d'app non vérifiée | `ChatRecovery.kt`, `SessionTail.kt` | Non |
| Gestion de Doze, batterie, interruptions | NON_VÉRIFIABLE | Aucune logique dédiée identifiée dans le code audité | Aucune logique Doze identifiée non plus | Non |

## F. UX mobile

| Capacité | Statut | Preuve Unifia | Référence DSH | Vérifié ici |
|---|---|---|---|---|
| Terminal utilisable sur mobile | PARTIELLE | `MOBILE_TERMINAL_STATE.md`, `runtime/pty_config.rs` | `Pty.kt` | Non |
| Notifications | EXISTANTE_VALIDÉE (host) | `packages/mobile/src/notifications.ts` ; `notifications.test.ts` : **2 pass** (avec `--preload ./happydom.ts`) | `UserPromptActivity.kt` | Oui |
| Prévisualisation HTTP loopback sécurisée | **ABSENTE** | Aucune route dédiée. `proxy.rs` est un proxy CONNECT pour Bun, à ne pas confondre | « Preview » local dans le README DSH | Oui (recherche) |
| Progression des agents | PARTIELLE | Non audité ici | `TickerBar.kt`, `StatusOverlay.kt` | Non |
| Voix (existante, à préserver) | EXISTANTE (non modifiée) | `packages/mobile/src-tauri/src/voice/` ; tests `eot_corpus_tests.rs` | `AsrManager.kt`, `TtsManager.kt` | Non |
| Gestion des toolchains dans l'UI | ABSENTE | — | `ExtensionStoreActivity.kt` | Oui |

## G. Qualification

| Capacité | Statut | Preuve | Vérifié ici |
|---|---|---|---|
| Tests host du runtime Rust | PARTIELLE | Workflow `mobile-runtime-tests.yml` (CI Linux). Non exécuté ici : dépendances GTK/WebKit absentes | Non |
| Tests Android instrumentés | **ABSENTE** | Aucun répertoire `androidTest` dans `packages/mobile` | Oui |
| Build APK ARM64 | NON_VÉRIFIABLE | Pas de SDK ni de NDK dans le cloud ; workflow `android.yml` | Non |
| Matrice ABI / API | ABSENTE | Pas de matrice ; DSH a `verify-runtime-abi.py` | Oui |
| Budget CPU / RAM / disque | ABSENTE | Aucun benchmark dans le dépôt | Oui |
| Tests unitaires TypeScript du module Android | EXISTANTE_VALIDÉE | `test/git/android-launcher.test.ts` 5/5 ; `test/permission/` 111/111 ; `src/notifications.test.ts` 2/2 | Oui |

## H. Gouvernance

| Capacité | Statut | Preuve |
|---|---|---|
| Invariant `main ⊂ dev ⊂ dev_auto` | **DÉFECTUEUSE** | `dev ⊂ dev_auto` faux ; `docs/production/EXECUTION-STATE.md` affirmait le contraire au 14/10. Resynchronisation `dev_auto` à décider par le propriétaire (D9) |

## Défauts démontrés à traiter en priorité

1. **Intégrité du rootfs** (`build-alpine-rootfs.sh:57-59`) : pas de SHA-256 sur le tarball Alpine. Correction : épingler le hash officiel du `.sha256` publié par Alpine et vérifier avant extraction. Le hash ne peut pas être récupéré depuis ce cloud (CDN Alpine refusé par le proxy, HTTP 403). Action propriétaire ou CI requise.
2. **Contradiction gcc** (`build-alpine-rootfs.sh:307` vs `toolchain.rs:73-80`) : le `|| true` masque l'échec de suppression, et la présence de `cc` n'est pas vérifiée après la construction. Correction : vérifier `cc`/`c++` après le strip et échouer si absent, puis confirmer par un build chroot réel.
3. **Versions non épinglées** (`build-alpine-rootfs.sh:82-101`) : sans version exacte, deux builds ne sont pas comparables.
4. **Invariant de branches rompu** : `dev` et `dev_auto` ont divergé (18 commits de chaque côté).
