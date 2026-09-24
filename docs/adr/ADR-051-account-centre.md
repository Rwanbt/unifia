<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-051: The account centre shows only real identity data

- Status: accepted
- Date: 2026-09-24
- Related: ADR-047 (settings follow the reference's structure)

## Context

The `user` destination (`pages/settings/user-surface.tsx`) was a placeholder.
Its French text was hard-coded, and it did not match the reference's account
centre: Vue d'ensemble, Personnel, Organisations and Sécurité.

The reference is a demo. It invents accounts, organisations, passkeys and
device sessions. The app knows only a few of these things:

- the collaborative identity signed in to this server (`/collab/*`);
- the Console organisations (`experimental.console.*`);
- the current server connection;
- the open projects.

## Decision

- The account centre follows the reference's layout. It has four pages in
  `components/account/`, and the surface only switches between them.
- Identity is the collaborative user when one is signed in. Otherwise it is
  the anonymous local profile. "Créer un compte" and "Se connecter" open the
  existing collaborative `LoginForm`.
- Organisations are the Console orgs, and switching one calls
  `experimental.console.switchOrg`.
- The session row is this device's connection to its server.
- Controls with no backend are shown disabled as `common.comingSoon`, as in
  ADR-047:
  - joining or creating an organisation;
  - multi-factor authentication, passkeys, recovery codes and stronger
    validation;
  - syncing preferences, restoring the last session, and revoking other
    sessions.
- The account frame reuses the settings palette tokens, section and row
  styles. It never fabricates a count or a device.
