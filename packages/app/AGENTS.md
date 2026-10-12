## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `unifia web` serves the interface built into the binary. It is not a live development server, so local UI/CSS changes do not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from `packages/unifia`): `bun run --conditions=browser ./src/index.ts serve --port 4096 --cors http://localhost:4444`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).
- The backend trusts only exact origins: the desktop app's, `http://localhost:1420` (the desktop dev server), and what `--cors` lists. Any other page origin is refused with 403, so the app's dev origin must be listed as above. The embedded interface, served by the backend itself, needs nothing.

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
