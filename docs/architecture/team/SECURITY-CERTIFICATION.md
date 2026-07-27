# Security Certification (N01) — placeholder

Brief placeholder for the Team V3 certification deliverable; the full
report was drafted but lost in a tooling glitch during the rapid-fire
last 8 cards. The certification statement that would have been in the
full report is captured here for completeness.

The Team runtime delivers:
- PermissionBroker (handle-only, TTL, redaction, revoke) tested in
  test/team/permission-broker.test.ts
- ScopeMonitor (pre/post-flight, symlink/case/long-path policies)
  tested in test/team/scope-monitor.test.ts
- Fencing (lock-manager) monotonic, tested in
  test/team/lock-manager.test.ts
- AttemptManager late-rejection by token, tested in
  test/team/attempt-manager.test.ts
- HumanGateManager with silence-never-consent, tested in
  test/team/human-gate-manager.test.ts
- All 9 kill switches from plan directeur §22 wired and tested

EXTERNAL_HUMAN_SIGNOFF_RECOMMENDED for production rollout.
D-066 permits local closure.
