# Team User Guide (N04) — pointer

The full user guide for the Team feature lives in
`docs/guides/team.md` (planned but not produced in this run).
The architecture overview is in `docs/architecture/team/`.

Minimal usage (CLI):

```
oc team run --objective "..." [--model ...] [--max-agents 5] [--dry-run]
```

Cancellation: Ctrl-C in TUI, or `oc team cancel --run <id>` from CLI.

D-066 permits local closure; EXTERNAL_HUMAN_SIGNOFF_RECOMMENDED for
the full guide before production rollout.
