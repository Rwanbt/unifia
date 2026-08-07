<!-- SPDX-License-Identifier: MIT -->
# Rebrand Unifia — état vérifié au 2026-08-07

Chiffres relevés par scan direct ce jour, pas de mémoire.

## ✅ Fait et vérifié

### Identité applicative
- [x] **Identifiant desktop** — `ai.unifia.workbench.dev`, productName « Unifia Dev »
- [x] **Identifiant mobile** — `ai.unifia.mobile`, productName « Unifia Mobile »,
      **validé sur appareil réel** (Mi 10 Pro, `LlamaEngine initialized`)
- [x] **Binaire CLI** — `bin: { "unifia": "./bin/unifia" }`
- [x] **Crates Rust** — `unifia-kokoro-shared`, `unifia-desktop`, `unifia-mobile` (3/3)

### Mobile — chaîne complète
- [x] 7 symboles JNI `Java_ai_unifia_mobile_*`
- [x] Bibliothèque native `libunifia_mobile_lib.so`
- [x] Répertoires de paquet Kotlin `ai/unifia/mobile/`
- [x] Thème `Theme.unifia_mobile`
- [x] 6 chemins codés en dur (Kotlin ×2, Rust ×1, C ×3)
- [x] Migration des 2,4 Go de données on-device par coexistence

### Configuration
- [x] **Répertoire global** — `const app = "unifia"` → `~/.config/unifia`,
      `~/.local/share/unifia`, cache et state
- [x] **Nom du fichier de config** — `unifia.json` / `unifia.jsonc`
- [x] **Variables d'environnement, côté lecture** — 37 flags canoniques `UNIFIA_*`
      avec repli `OPENCODE_*` documenté dans `flag/flag.ts`

### Paquets
- [x] **34 paquets sous `@unifia/*`**

---

## ⬜ Reste à faire

Classé du plus mécanique au plus délicat.

### Mécanique — remplacement sûr
- [ ] **11 paquets encore `@opencode-ai/*`** — `console-app`, `console-core`,
      `console-function`, `console-mail`, `console-resource`, `plugin`, `script`,
      `sdk-shared`, `sdk`, `ui`, `util`
      *Attention : `@opencode-ai/sdk` et `@opencode-ai/plugin` sont des noms
      **publiés publiquement**. Les renommer casse les consommateurs externes —
      c'est une décision de distribution, pas un rebrand cosmétique.*
- [ ] **Nom du paquet CLI** — `packages/opencode/package.json` s'appelle encore
      `opencode` (sans scope), alors que son binaire est déjà `unifia`
- [ ] **58 occurrences « OpenCode » dans 18 fichiers de locale** (`packages/app/src/i18n/`)
- [ ] **53 occurrences « OpenCode » dans des littéraux d'interface**

### Demande une décision
- [ ] **Répertoire de config projet `.opencode/`** — 8 occurrences. État actuel
      incohérent : `.opencode/unifia.json`. Le renommer en `.unifia/` **casse les
      projets existants** qui ont déjà un `.opencode/` — il faut soit une
      migration, soit lire les deux
- [ ] **Variables d'environnement, côté émission** — `packages/mobile/src-tauri/src/runtime/server.rs`
      émet encore 6 noms `OPENCODE_*` (`OPENCODE_CLIENT`, `OPENCODE_PTY_PORT`,
      `OPENCODE_SERVER_USERNAME/PASSWORD`, `OPENCODE_AUTH_STORAGE`,
      `OPENCODE_DISABLE_LSP_DOWNLOAD`). **Ce n'est pas un bug** — le shim les lit —
      mais le nom hérité reste porteur
- [ ] **5 lectures directes qui contournent le shim** — `ide/index.ts:47`,
      `share/share-next.ts:20`, `tool/bash.ts:356,696,697`. Elles lisent
      `process.env.OPENCODE_*` sans repli, donc elles **ignoreraient** un
      `UNIFIA_*` équivalent

### Périmètre à trancher
- [ ] **Domaine `opencode.ai`** — 562 fichiers, dont **417 dans `packages/web`**
      (site vitrine amont). Hors `web` : 69 dans le cœur CLI, 38 dans `ui`,
      7 dans `app`, 4 dans `desktop`, 3 dans `mobile`.
      *`packages/web` est le site du projet amont, pas l'application. À décider :
      le rebrander, le supprimer du fork, ou le laisser tel quel.*

---

## 🔒 Ne doit **pas** changer

- [x] **`ai.opencode.desktop` / `ai.opencode.desktop.dev`** dans le CLI embarqué —
      c'est la **détection de l'application OpenCode officielle**. La renommer
      casserait la détection.
- [x] **`ai.opencode.managed`** — domaine de profil MDM macOS, convention amont.
- [x] **Traçabilité de provenance** — `UPSTREAM-SOURCES.lock.json`,
      `THIRD-PARTY-NOTICES.md`, `UPSTREAM-PROVENANCE.md` doivent continuer à
      nommer l'amont : c'est ce qui rend la conformité de licence vérifiable.

---

## Ce que « complètement rebrandé » veut dire

Trois niveaux, à ne pas confondre :

| Niveau | État |
|---|---|
| **Ce que l'utilisateur voit** — nom de l'app, binaire, fenêtres, config globale | **fait** |
| **Ce que l'utilisateur touche** — locales, littéraux UI, config projet | **partiel** |
| **Interne** — noms de paquets npm, variables d'environnement héritées, domaine | **partiel, et certains points ne doivent pas bouger** |

Le premier niveau est celui qui décide si l'application « est » Unifia. Il est
complet. Les deux autres sont de la cohérence, pas de l'identité — et deux items
(`@opencode-ai/sdk`, `.opencode/`) ont des **conséquences externes** qui en font
des décisions, pas des tâches.
