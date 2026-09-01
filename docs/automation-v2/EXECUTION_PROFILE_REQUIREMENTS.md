<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# EXECUTION PROFILE REQUIREMENTS — UNIFIA AUTOMATE

> Statut : **PINNED** (livrable §24-29 du plan)
> Date : 2026-09-01T16:35+02:00
> Source : plan V2.3.1, BASELINE.md, AUTOMATE_TRUST_PATH.md, THREAT_MODEL.md.
> Ce document est gelé **avant** ADR-000 (plan §24).

8 profils évalués. Classification : `MANDATORY` / `OPTIONAL` /
`FUTURE_COMPATIBILITY_REQUIRED` / `UNSUPPORTED`.

---

## 0. Cible première

`Automate Core × local-single-node × Windows` (plan §FIRST TARGET).
**MANDATORY** : c'est la cible de certification GA Automate Local.

---

## 1. Profils

### 1.1 `local-single-node` — MANDATORY

| Requirement | Valeur | Justification |
|---|---|---|
| offline required? | **oui** | plan §28 : « offline execution » pour local-first. |
| self-contained required? | **oui** | single-machine deployment. |
| external daemon allowed? | **non** | pas de daemon séparé. Un sidecar entièrement géré par Unifia peut être accepté (plan §28). |
| external administered DB allowed? | **non** | pas de cluster administré. |
| Bun required? | **oui** | stack actuel = Bun + SolidJS. |
| Node acceptable? | **oui** | Node acceptable en fallback (plan §27). |
| Windows? | **oui** | cible première, build Tauri vert (SESSION-2 §5). |
| Linux? | FUTURE | pas mesuré dans ce tour. |
| macOS? | FUTURE | pas mesuré. |
| Android? | non | pas exigé pour Automate Core local. |
| packaging constraints? | sidecar CLI = `unifia.exe` (194 Mo) + Tauri exe (53 Mo) | mesuré SESSION-2 §5. |
| HA required? | **non** | single-node. |
| network requirements? | boucle locale possible | pas d'egress obligatoire. |
| storage requirements? | filesystem local + SQLite | Drizzle ORM `storage/` (INFERRED). |
| resource ceiling? | non dur | ajusté selon usage. |
| operational complexity? | faible | pas de cluster, pas de HA. |

**Conclusion** : le profil `local-single-node` exige un kernel
d'exécution qui marche offline, self-contained, sans daemon externe.

### 1.2 `server-single-node` — FUTURE_COMPATIBILITY_REQUIRED

| Requirement | Valeur | Justification |
|---|---|---|
| offline required? | non | peut avoir un réseau. |
| self-contained required? | oui | un seul nœud. |
| external daemon allowed? | oui | service installé. |
| external administered DB allowed? | non | SQLite ou Postgres auto-hébergé. |
| Bun required? | oui | alignement stack. |
| Node acceptable? | oui | fallback. |
| Windows? | oui | Tauri serveur Windows possible. |
| Linux? | oui | serveur Linux standard. |
| macOS? | oui | idem. |
| Android? | non | pas exigé. |
| packaging constraints? | service systemd / launchd | par OS. |
| HA required? | non | single-node. |
| network requirements? | IP publique ou privée. | |
| storage requirements? | local FS + DB. | |
| resource ceiling? | à mesurer. | |
| operational complexity? | moyenne | service, logrotate, monitoring. |

**Conclusion** : compatible avec le même kernel qu'`local-single-node`,
plus un packaging service.

### 1.3 `server-cluster` — FUTURE_COMPATIBILITY_REQUIRED

| Requirement | Valeur | Justification |
|---|---|---|
| HA required? | **oui** | multi-nœuds. |
| distributed worker fleet? | **oui** | ADR-008 (Scheduler/Worker/Time Authority), ADR-022 (Timer). |
| rolling upgrade? | **oui** | ADR-018. |
| external administered DB allowed? | oui | Postgres managé acceptable. |
| cluster recovery? | oui | ADR-208, ADR-209. |

**Conclusion** : exige les tracks post-M3 (Distributed Server, ADR-008,
ADR-018, ADR-022). Compatible avec le même kernel.

### 1.4 `browser-isolated-worker` — FUTURE_COMPATIBILITY_REQUIRED

| Requirement | Valeur | Justification |
|---|---|---|
| Browser required? | oui | `browser-runtime`. |
| isolated worker? | oui | ADR-013, ADR-024. |
| network sandbox? | oui | §144 : Network Authority + OS enforcement. |
| auth profiles? | oui | `BrowserAuthProfileRef`. |
| live observation? | oui | `observationId` (§151). |
| AI Computer Use? | post-M3 | B2. |
| take-over? | post-M3 | §155. |
| kill switch? | oui | durable, scopes global/org/workspace/run/browser/desktop. |

**Conclusion** : exigé pour `Automate Browser`. Pas pour la cible première.

### 1.5 `desktop-host-assisted` — OPTIONAL

| Requirement | Valeur | Justification |
|---|---|---|
| app allowlist? | oui | §158. |
| window identity? | oui | |
| foreground validation? | oui | |
| restricted actions? | oui | strong approvals. |
| best-effort? | oui | §158 « Best-effort ». |

**Conclusion** : exigé pour `Automate Desktop` profile. **Best-effort**
signifie qu'il n'est pas un boundary de sécurité.

### 1.6 `desktop-isolated-worker` — FUTURE_COMPATIBILITY_REQUIRED

| Requirement | Valeur | Justification |
|---|---|---|
| dedicated OS session / VM? | oui | §159. |
| network isolation? | oui | |
| filesystem boundary? | oui | |
| application allowlist? | oui | |
| process identity? | oui | |
| restricted system surfaces? | oui | |

**Conclusion** : exigé pour `Automate Desktop` profile full-isolation.

### 1.7 `mobile-control` — FUTURE_COMPATIBILITY_REQUIRED

| Requirement | Valeur | Justification |
|---|---|---|
| mobile device acts as control? | oui | §29. |
| network reach required? | oui | Wi-Fi / cellulaire. |
| authenticated channel? | oui | TLS + principal. |

**Conclusion** : exigé pour piloter Automate depuis mobile. Pas pour
la cible première.

### 1.8 `mobile-local-execution` — FUTURE_COMPATIBILITY_REQUIRED

| Requirement | Valeur | Justification |
|---|---|---|
| mobile device runs substrate? | oui | §29. |
| offline? | oui | |
| Android (Tauri mobile)? | oui | `packages/mobile/` existe. |
| iOS? | non présent | à venir. |

**Conclusion** : ADR-000 ne doit pas fermer cette possibilité. Le choix
de substrate doit rester compatible avec un runtime local Android
(notamment Bun/Node ou kernel natif léger).

---

## 2. Local-first (plan §28)

`local-single-node` exige :
- single-machine deployment ✓
- offline execution ✓
- no separately administered workflow cluster ✓
- no mandatory proprietary cloud ✓

Un sidecar entièrement géré par Unifia **peut** être accepté. C'est le cas
actuel (`packages/unifia` sidecar CLI bun-compilé, livré avec Tauri).

---

## 3. Mobile (plan §29)

- `mobile-control` ≠ `mobile-local-execution`. On ne rejette pas un
  substrate simplement parce que l'exécution locale Android n'est pas
  immédiatement disponible, si `mobile-local-execution` est classé
  `FUTURE_COMPATIBILITY_REQUIRED` et que le choix ne ferme pas cette
  possibilité.
- ADR-000 doit donc explicitement vérifier que le substrate choisi est
  portable vers Android (TS/Bun/Node ou kernel natif compilable).

---

## 4. Synthèse

| Profile | Classification | Bloque ADR-000 ? |
|---|---|---|
| local-single-node | **MANDATORY** | oui (cible première) |
| server-single-node | FUTURE_COMPATIBILITY_REQUIRED | non |
| server-cluster | FUTURE_COMPATIBILITY_REQUIRED | non |
| browser-isolated-worker | FUTURE_COMPATIBILITY_REQUIRED | non |
| desktop-host-assisted | OPTIONAL | non |
| desktop-isolated-worker | FUTURE_COMPATIBILITY_REQUIRED | non |
| mobile-control | FUTURE_COMPATIBILITY_REQUIRED | non |
| mobile-local-execution | FUTURE_COMPATIBILITY_REQUIRED | non (mais vérifie compatibilité Android) |

Aucun profile `UNSUPPORTED` : la doctrine « sovereignty + local-first »
interdit de marquer un profile comme structurellement impossible.

---

## 5. Contraintes dérivées pour ADR-000

ADR-000 doit vérifier que le substrate satisfait :

| Contrainte | Source |
|---|---|
| Offline (local-single-node) | §28 |
| Self-contained (local-single-node) | §28 |
| Pas de daemon externe obligatoire | §28 |
| Pas de cluster administré obligatoire | §28 |
| Pas de cloud propriétaire obligatoire | §28 |
| TS-compatible | stack Bun/SolidJS |
| Android-compatibilité possible (mobile-local-execution) | §29 |
| License compatible (MIT) | projet |
| Self-hostable | souveraineté |
| Durable wait, durable approval, crash recovery, backup/restore | §35 |
| Operational burden acceptable pour local | §35 |

Les hard eliminators sont dans ADR-000.
