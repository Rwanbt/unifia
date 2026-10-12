<!-- SPDX-License-Identifier: MIT -->
# RC-0 Home server control qualification

## Reproduced baseline

On dev4dc518bf3b, the unchanged two Home journeys fail with process exit1.
The first expects visible empty-project text in the desktop context panel.
The snapshot and v110-home.css confirm that Home intentionally hides this
panel. The current Home instead exposes its heading, project entry point
and six mode/destination buttons.

The second cannot find a server-name button. The snapshot contains the
correct server address, but its button's accessible name is Open project.
Home's click handler opens DialogSelectServer while its aria-label uses
command.project.open. This is an action/name mismatch in production.
Both failures also occur in the preserved Linux full-browser log for #194;
they are not Windows timing flakes.

## Scoped correction

Use the existing translated command.server.switch plus server.name for
the Home server control. No new translation keys or transport are added.
The Home test checks the visible project action and heading, six launch
buttons, the intentionally hidden context panel, and the server identity.
The server-picker journey asserts Switch server in the accessible name,
performs a real click, and checks the visible dialog and textbox.

Command: bun run test:e2e:local -- e2e/app/home.spec.ts --workers=1 --retries=0
Result after correction: 2 passed in 7.8s, complete process exit0.
No force click, retries or timeout increase. Baseline snapshot and screenshot
are retained as rc0-home-baseline-context-20261002.md and
rc0-home-server-baseline-20261002.png under rc0-agent/.build-temp.
Repository-wide search finds this Home anchor only in the production Home
control and its parity manifest; other server-name tests assert actual
server rows. Their remaining full-suite failures require separate diagnosis.
Full CI, physical tests and QA12R remain open.
