# DUPLICATION-MATRIX.md

**Phase :** -1 (Audit comparatif)
**Statut :** `DRAFT` — basé sur lecture des README + top-level ; raffinement requis en Phase 1
**Date :** 2026-07-31

## 1. Méthodologie

Pour chaque domaine fonctionnel, on compare :
- Le code existant dans le **fork Unifia** (à garder / adapter)
- Le code dans **OpenWork upstream** (à importer ou réécrire)
- Le code dans **Open Cowork upstream** (à importer ou réécrire)
- Le **doublon** éventuel (même fonctionnalité dans 2+ repos)

Catégorisation :
- **DOUBLON_FORT** : même fonctionnalité, même design → fusionner en Unifia Core
- **DOUBLON_FAIBLE** : même domaine, designs différents → adopter le meilleur, réécrire l'autre
- **COMPLEMENTAIRE** : pas de doublon, comble un manque
- **CONFLIT** : designs incompatibles, choisir l'un ou l'autre
- **N/A** : pas de doublon

## 2. Matrice de duplication

| Domaine | Fork Unifia | OpenWork | Open Cowork | Doublon | Décision |
|---|---|---|---|---|---|
| **Runtime agentique** | ✅ (`opencode/src/runtime`) | ✅ (côté OpenCode embarqué) | ❌ | **DOUBLON_FORT** | Refactorer : OpenCode reste comme `OpenCodeRuntimeAdapter`, Unifia Core = `UnifiaRuntimeAdapter`. Plan V3 §7.1. |
| **Session management** | ✅ | ✅ | ❌ | **DOUBLON_FORT** | Unifia Core owns. OpenCode = adapter. |
| **Provider routing** | ✅ (10 providers) | ❌ (côté OpenCode) | ❌ | **N/A** | Unifia Core owns (déjà existant). |
| **MCP client** | probable | ✅ | probable | **DOUBLON_FAIBLE** | Unifia Core owns ; OpenWork peut être importé comme référence. |
| **Tools registry** | ✅ | ✅ | probable | **DOUBLON_FAIBLE** | Unifia Core owns via CapabilityRegistry (Phase 4+). |
| **Workspace identity** | probable | ✅ (multi) | ❌ | **DOUBLON_FAIBLE** | WorkspaceRuntime = Unifia App. OpenWork sert d'inspiration. |
| **File sessions** | probable | ✅ | ❌ | **DOUBLON_FAIBLE** | WorkspaceRuntime owns. |
| **Multi-workspace** | ❌ | ✅ | ❌ | **COMPLEMENTAIRE** | ADOPT depuis OpenWork (Phase 5). |
| **Skills / Plugins** | probable | ✅ | probable | **DOUBLON_FAIBLE** | CapabilityRegistry owns ; manifest typé inspiré d'OpenWork. |
| **Permission system** | probable | probable | probable | **DOUBLON_FAIBLE** | Réécrire en PolicyEngine (Plan V3 §3.3). |
| **Approvals** | probable | probable | probable | **DOUBLON_FAIBLE** | ApprovalBroker unique. |
| **Secrets** | probable | `.infisical.json` | probable | **CONFLIT** | Réécrire (Plan V3 §3.3). Ne pas adopter Infisical. |
| **Memory** | probable | probable | ❌ | **DOUBLON_FAIBLE** | MemoryRuntime = Unifia. Migrer les idées utiles d'Open Cowork. |
| **Config store** | probable | probable | probable | **DOUBLON_FAIBLE** | Config versionnée Unifia (Plan V3 §3.2). |
| **Trace / EventLog** | probable | probable | probable | **DOUBLON_FAIBLE** | AuditRuntime + Trace UI. |
| **Artifacts (DOCX/PPTX/XLSX/PDF)** | ❌ | probable | ✅ (78 XSD) | **COMPLEMENTAIRE** | ADOPT depuis Open Cowork comme Capability Packs (Phase 6). |
| **Browser profile** | ❌ | probable | probable | **COMPLEMENTAIRE** | ADAPTER tardif (Phase 10). |
| **Computer use** | ❌ | probable | probable (Python) | **COMPLEMENTAIRE** | ADAPTER tardif (Phase 10) avec DesktopAutomationBroker. |
| **Sandbox Docker** | probable | probable | probable | **DOUBLON_FAIBLE** | SandboxBroker unifie. |
| **Sandbox WSL2/Lima** | ❌ | probable | probable (Python) | **COMPLEMENTAIRE** | ADAPTER depuis Open Cowork (Phase 6+). |
| **Remote bridges (Slack/Feishu)** | `packages/slack/` | probable | probable (Feishu) | **COMPLEMENTAIRE** | ADAPTER Open Cowork pour Feishu. |
| **Desktop Tauri** | ✅ (`packages/desktop/`) | probable | probable | **DOUBLON_FAIBLE** | Unifia = Tauri. Reuse. |
| **Desktop Electron** | ✅ (`packages/desktop-electron/`) | ❌ | probable | **DOUBLON_FORT** | DEPRECATE (BD-3). |
| **Mobile Tauri** | ✅ (`packages/mobile/`) | Swift natif | probable | **DOUBLON_FAIBLE** | Tauri garde-fou. Swift natif = Phase 19+. |
| **CLI** | ✅ (`bin/opencode`) | probable | probable | **DOUBLON_FAIBLE** | Unifia CLI = binaire `unifia` (P0-C004). |
| **i18n** | ✅ (21 langues) | probable | probable | **DOUBLON_FAIBLE** | Overlay utilisateur à intégrer (carte `P-1-I18N-USER-SOURCE`). |
| **Server headless** | ❌ | ✅ `apps/server/` | ❌ | **COMPLEMENTAIRE** | ADOPT OpenWork (Phase 5). |
| **OpenCode embarqué** | (le fork EST opencode) | ✅ OpenCode embarqué | ❌ | **DOUBLON_FORT** | Garder opencode comme adapter legacy, ne pas dupliquer runtime. |

## 3. Doublons forts (à arbitrer en Phase 2)

Les **3 doublons forts** sont les plus risqués :

### 3.1 Runtime agentique (Unifia fork + OpenWork embarqué)

**Risque :** si on garde les deux, on a deux boucles agentiques concurrentes. Le Plan V3 §2.1 liste les risques : sessions, providers, tools, permissions, secrets, mémoire, workspaces, MCP, storage, packaging.

**Décision :** Unifia Core owns. OpenCode devient `OpenCodeRuntimeAdapter` (compat ascendante).

### 3.2 Session management

**Risque :** deux définitions de session → corruption, perte de messages.

**Décision :** Unifia Core owns. OpenCode adapter consomme.

### 3.3 Desktop Electron + Tauri

**Risque :** double surface UI → fragmentation UX, double maintenance.

**Décision :** DEPRECATE Electron (BD-3 par défaut). Phase 0 (rebrand) marque le package.

## 4. Conflits détectés

### 4.1 Infisical (OpenWork) vs SecretStore Unifia

**Conflit :** OpenWork utilise Infisical (`.infisical.json`). Le Plan V3 §3.3 dit « stockage des secrets : réécrire plutôt que copié ».

**Décision :** ne pas adopter Infisical. Réécrire SecretStore Unifia (Phase 3).

### 4.2 Swift natif (OpenWork) vs Tauri (Unifia)

**Conflit :** OpenWork a du code Swift natif iOS/macOS. Unifia fork est full Tauri (Bun + TS + Rust via Tauri).

**Décision :** Tauri garde-fou pour Phase 0-16. Swift natif = Phase 19+ (post-production, modules stratégiques).

## 5. Conclusion

- **3 doublons forts** à arbitrer (runtime, sessions, Electron/Tauri).
- **~15 doublons faibles** où Unifia Core/WB owns, mais on peut importer les bonnes idées d'OpenWork/Open Cowork.
- **~10 complétements** où Unifia a un trou comblé par l'un des upstreams.
- **2 conflits** qui forcent une réécriture (secrets, Swift natif).

Le coût principal n'est pas l'import initial, mais la **suppression des doublons** (cf. Plan V3 §0). C'est pourquoi chaque import doit être accompagné d'un **plan de suppression** de l'autorité parallèle.
