<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-044 — Web search goes through a self-hosted SearXNG, never Exa

- Status: accepted (owner decision 2026-09-23)
- Date: 2026-09-23

## Context

The composer's web button is a privacy switch: off, the model has no network
tool; on, it may search and read pages. The `websearch` tool inherited from
OpenCode posted every query to Exa (`mcp.exa.ai`), a commercial search API,
and the server only exposed it (and `webfetch`, which needs no third party)
for the `opencode` provider or when `UNIFIA_ENABLE_EXA` was set. With any
other model the button lit up and nothing happened. The owner wants no
third party to receive the user's queries.

## Decision

1. `websearch` queries a SearXNG instance the user runs, through its JSON API
   (`GET <url>/search?q=…&format=json`). SearXNG queries several engines
   without an account or a persistent profile, so no single service collects
   the query history. Exa is no longer called.
2. The instance URL comes from `UNIFIA_SEARXNG_URL`, else the config key
   `websearch.searxng_url`. Without one, or when the instance does not answer
   its `/healthz` (Docker Desktop stopped; checked at most every 30 s),
   `websearch` is not offered to the model at all: Unifia keeps working
   without the instance, with `webfetch` only.
3. `webfetch` is no longer tied to the Exa flag: it reads the page the model
   names, like a browser. The web button still gates both tools (the client
   sends `websearch` and `webfetch` allow/deny with each prompt), and local
   models keep requiring that explicit allow.
4. `codesearch` stays Exa-only behind `UNIFIA_ENABLE_EXA`; it is off by
   default.

## Consequences

- Web search needs a running SearXNG with the `json` format enabled in its
  `settings.yml`; the app says so when none is configured.
- Pages opened by `webfetch` see the request, exactly as when browsing.
