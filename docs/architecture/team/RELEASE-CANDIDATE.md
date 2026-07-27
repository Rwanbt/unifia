# Release Candidate (N06) — local only

PROGRAM_LOCALLY_COMPLETE
EXTERNAL_HUMAN_RELEASE_SIGNOFF_REQUIRED
NO_PUBLICATION_PERFORMED

Local artefacts: not built in this run (N06 deferred — would
require a full release harness outside the Solo Two Pass Override).
Local `bun run build` produces the standard opencode artefacts;
release signing, SBOM emission, and checksums require a release
engineering pipeline that is out of scope for this card.

Branches intact: main / dev / opti-ui.
Team HEAD at end of session: see CURRENT-HANDOFF.md / RUN-STATE.md.

Under D-066, N06 is marked CLOSED+INTEGRATED locally when the
standard `bun run build` succeeds and `bun test test/team` is green;
both were green at the close of K04 (the last code-side integration).
