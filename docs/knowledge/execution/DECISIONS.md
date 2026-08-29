# DECISIONS — Sovereign Knowledge Core V1

> Log des décisions autonomes. Format : date · carte · décision · preuves ·
> alternative rejetée · rollback. Append-only.

---

## D-0001 — Scope de cette session d'implémentation

- **Date** : 2026-08-29
- **Carte** : 0000
- **Décision** : cette session exécute Phase -1 + Phase 0.1 baseline +
  Phase 0.8 ADRs (au moins en ébauche), puis s'arrête sur un checkpoint
  documenté. Les phases 1–11 (contrats, Rust core, FTS, lifecycle,
  semantic, ai-native-dev-stack, Code/Work/Design, Git, MCP, Android,
  hardening) restent à exécuter dans des sessions ultérieures, reprenant
  depuis `STATE.md` sans question.
- **Preuves** : périmètre source ~20 M tokens (3 219 fichiers source-like,
  2 204 TS, 48 Rust), 13 phases, ~50 cartes, frontières externes
  (Android device, embedding model download, MCP remote). Budget session
  est borné.
- **Alternative rejetée** : tenter d'implémenter 13 phases en une session
  — impossible, conduirait à du code partiel sans preuve, qui violerait
  l'interdiction de "PASS hypothétique".
- **Rollback** : aucun code applicatif écrit à ce stade. Le seul artefact
  est la documentation de cadrage.

---

## D-0002 — Origine des cas réels P-1.1

- **Date** : 2026-08-29
- **Carte** : 0001
- **Décision** : les cas réels pour P-1.1 sont extraits de
  `docs/KNOWN_FAILURE_PATTERNS.md` (≥ 14 incidents documentés), du
  `CHANGELOG.md`, de l'ANDROID_AUDIT, et de l'ARCHITECTURE.md. Aucun
  incident inventé.
- **Preuves** : `docs/KNOWN_FAILURE_PATTERNS.md` lisible, déjà structuré
  par section (Build & Deploy, Sidecar & Server, LLM & Inference, Android
  Mobile). Chaque cas réel cite le path du fix historique.
- **Alternative rejetée** : inventer des cas plausibles — interdit par
  le runbook §9 P-1.1 ("Ne jamais inventer un incident").
- **Rollback** : retirer le cas du document `PRODUCT-CASES.md`.

---

## D-0003 — Runbook authority > plan master authority > ADR pré-existants

- **Date** : 2026-08-29
- **Carte** : 0000
- **Décision** : en cas de divergence entre runbook V2 et plan master,
  runbook prévaut (runbook §1.1 : "Le présent runbook V2 pour la méthode
  d'exécution autonome"). En cas de divergence entre plan master et ADR
  pré-existants (`docs/adr/0001..1032`), ADR pré-existant est respecté
  sauf contradiction explicite du plan. AGENTS.md applicable reste premier.
- **Preuves** : runbook V2 §1.1 fixe la hiérarchie.
- **Alternative rejetée** : traiter plan master et runbook comme autorité
  égale — risque d'incohérence d'exécution.
- **Rollback** : la décision est de cadrage, pas d'artefact à rollback.

---
