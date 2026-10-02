<!-- SPDX-License-Identifier: MIT -->
# RC-0 Design connection and approval qualification

## Baseline and causes

The unchanged completed-export journey on dev4dc518bf3b fails with exit1:
data-design-connection=ready does not exist. The baseline snapshot is kept
in rc0-agent/.build-temp/rc0-design-baseline-context-20261002.md.
The Canvas migration removed ConnectionBanner and DesignSplit. The helper
also expects the old split and a visible Spec tab on the default Canvas.
Current Design reaches Spec through the Atelier menu in Editor layout.

The three Spec actions check source text but not connection or parsed spec.
Their handlers return without doing anything when either is absent. A
disconnected user can therefore activate an action that silently does nothing.

## Correction and extraction

Extract ApprovalModal and its actions to a dedicated component, preserving
callbacks, state selectors, expiry controls and translations. Surface shrinks
from 932 to 813 lines; its remaining tab routing is a future extraction seam.
Restore the shared connection banner and gate all three Spec write actions
on a connected client and parsed spec. No transport or broker policy changes.
The shared Design helper retains its ready-state assertion, follows the real
mode/layout/Atelier controls and checks the current surface anchor.
The real web-denial journey also verifies failed Design connection and three
disabled write actions with a valid spec.

## Evidence and remaining limits

App typecheck PASS; approval/surface unit tests 28pass/64assertions/639ms.
Complete App unit suite: 2106pass/1existing live-STT skip/0fail,
151463assertions/7.23s, JUnit rc0-design-app-unit-20261002.xml retained.
Completed-export browser witness 1pass26.4s/exit0. Combined accessibility,
expiry/cancellation/navigation and real web-denial journeys 7pass47.5s/exit0,
one worker and zero retries. Workbench security guard PASS after correction.
Commands use bun run test:e2e:local with the three relevant spec files and
the recorded grep selecting those seven states; source helpers list the paths.

Export and approval journeys use the existing Workbench mock; web denial
uses the real HTTP404 boundary. Export through a real native transport is
not proved. Axe retains its existing color-contrast debt; no WCAG certificate
is claimed. The two grant-dependent Automate rail expectations and other
obsolete split fixtures remain separately unqualified. Full CI, physical
tests and QA12R are still open.
