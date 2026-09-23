<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-043 — The composer's permission mode tightens agent rules on the server

- Status: accepted (owner decision 2026-09-23: "Ask demande vraiment")
- Date: 2026-09-23

## Context

The composer offers Ask / Auto Edit / Full Auto. The mode only lived in the
client, which auto-answers the permission requests the server sends. The
build agent inherits OpenCode's `"*": "allow"`, so the server never asked
before editing a file or running a command, and "Ask" silently let the agent
write (verified live: a file was written in Ask mode with no prompt).

Session rules are appended after the agent's rules and the last matching rule
wins, so adding `edit: ask` as a session rule would also loosen an agent's
`deny` (the chat agent's `"*": "deny"`, an `edit: deny` on `*.env`) into a
question.

## Decision

1. The prompt input carries an optional `permissionMode` (`ask`, `auto-edit`,
   `full-auto`). The server stores it on the session (`permission_mode`
   column); a sub-agent session inherits its parent's mode.
2. The mode restricts permissions: `ask` restricts `edit` and `bash`,
   `auto-edit` restricts `bash`, `full-auto` restricts nothing.
3. At every place a tool asks for permission, the merged ruleset goes through
   `Permission.tighten(ruleset, restricted)`: right after each `allow` rule
   that covers a restricted permission, an `ask` rule with the same pattern is
   inserted. Rule order is otherwise unchanged, so the mode can only turn an
   `allow` into an `ask`; it never turns a `deny` or an `ask` into anything
   weaker.
4. Tool visibility (`Permission.disabled`) is untouched: an `ask` does not
   hide a tool.

## Rejected alternatives

- Changing the build agent's defaults to `ask`: it would also block the CLI
  and headless `run`, which have no composer mode.
- Appending session rules: loosens denies, as described above.
- Keeping the mode in server memory: lost on restart and not visible to
  sub-agent sessions.

## Consequences

- Ask mode shows the permission dock before every file change and command.
- Clients that do not send `permissionMode` keep today's behaviour.
