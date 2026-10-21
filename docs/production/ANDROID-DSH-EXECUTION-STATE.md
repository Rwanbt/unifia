<!-- SPDX-License-Identifier: MIT -->
# État d'exécution — parité Android avec DSH

Point de reprise de ce chantier. Une session qui reprend part d'ici, du dépôt et des PR,
jamais de la conversation. Le point d'entrée général reste
[EXECUTION-STATE.md](EXECUTION-STATE.md).

Mise à jour : 2026-10-21.

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
| 2 | Lot C2 : épingler le tarball Alpine et les versions de paquets ; supprimer `\|\| true` | Hash officiel Alpine (CDN 403 ici) |
| 3 | Lot E : nettoyage des processus orphelins (Rust, testable host) | Décision d'architecture (B/C) |
| 4 | ADR d'architecture et benchmark | Appareil Android du propriétaire |
| 5 | Lots C3 à C6 | Décision d'architecture, C2 |

## Blocages connus

- **Pas d'Android SDK/NDK, pas d'adb, pas de GPU, pas de qemu** dans ce cloud : aucun APK,
  aucun test instrumenté, aucun benchmark.
- **CDN Alpine refusé** (HTTP 403 via le proxy) : impossible de récupérer le rootfs ou son hash.
- **Libs GTK/WebKit absentes** : tests host Rust du runtime non exécutés ici ; la CI les lance.
- **Invariant de branches rompu** (ci-dessus).
- **`.github/**` interdit** aux agents (D11) : pas de workflow Android ajouté par ce chantier.

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
