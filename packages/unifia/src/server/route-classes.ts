/**
 * The action class of every sidecar route: the one mapping the central authorization boundary reads.
 *
 * A route that is not listed here is refused for every caller (default deny). The test in
 * test/server/route-registry.test.ts asserts that each route the server registers has an entry, and that no entry
 * names a route the server does not register.
 *
 * The classes are assessed by what a route does, not by where it lives. The minimum level each class needs is in
 * route-authority.ts, the one policy for who may do what, so role changes are made there and not route by route.
 */

export const ACTION_CLASSES = [
  "public",
  "read-metadata",
  "read-content",
  "write-content",
  "execute",
  "credential",
  "config",
  "admin",
  "diagnostic",
] as const

export type ActionClass = (typeof ACTION_CLASSES)[number]

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ALL"

export type RouteClass = readonly [method: RouteMethod, path: string, action: ActionClass]

/**
 * A path ending in "/*" matches every path under its prefix. The one wildcard entry is the Workbench bridge (ALL
 * /workbench/*), which authenticates its own requests with its scoped token. The embedded web interface is not an entry:
 * the boundary answers its static paths itself (see route-authority.ts). Every other entry is exact.
 */
export const ROUTE_CLASSES: readonly RouteClass[] = [
  // Public: answered without the boundary's principal. The Workbench bridge authenticates its own requests, and the
  // login, refresh and logout routes take their own credential. The first account is created by POST /collab/register,
  // whose handler keeps the rule that later accounts need an admin.
  ["ALL", "/workbench/*", "public"],
  ["ALL", "/workbench/native/token", "public"],
  ["POST", "/collab/login", "public"],
  ["POST", "/collab/refresh", "public"],
  ["POST", "/collab/logout", "public"],
  ["POST", "/collab/register", "public"],

  // Outer routes (no project directory): accounts, global configuration, provider and voice relays.
  ["GET", "/doc", "read-metadata"],
  ["POST", "/log", "write-content"],
  ["POST", "/collab/ws-ticket", "read-metadata"],
  ["GET", "/collab/me", "read-metadata"],
  ["GET", "/collab/users", "admin"],
  ["GET", "/global/health", "read-metadata"],
  ["GET", "/global/event", "read-content"],
  ["GET", "/global/sync-event", "read-content"],
  ["GET", "/global/config", "read-metadata"],
  ["PATCH", "/global/config", "config"],
  ["POST", "/global/dispose", "admin"],
  ["POST", "/global/upgrade", "execute"],
  ["PUT", "/auth/:providerID", "credential"],
  ["DELETE", "/auth/:providerID", "credential"],
  ["POST", "/workbench-web/token", "write-content"],
  ["GET", "/voice/live/status", "write-content"],
  ["POST", "/voice/live/session", "write-content"],
  ["POST", "/voice/live/bindings/:id/session", "write-content"],
  ["GET", "/voice/live/bindings/:id", "write-content"],
  ["DELETE", "/voice/live/bindings/:id", "write-content"],
  ["POST", "/voice/tts", "write-content"],
  ["POST", "/voice/tts/cancel", "write-content"],

  // Instance and project metadata.
  ["GET", "/presence", "read-metadata"],
  ["POST", "/instance/dispose", "admin"],
  ["GET", "/disk", "diagnostic"],
  ["GET", "/path", "diagnostic"],
  ["GET", "/vcs", "read-metadata"],
  ["GET", "/vcs/diff", "read-content"],
  ["GET", "/command", "read-metadata"],
  ["GET", "/agent", "read-metadata"],
  ["GET", "/skill", "read-metadata"],
  ["POST", "/skill/install", "config"],
  ["DELETE", "/skill/:name", "admin"],
  ["GET", "/lsp", "read-metadata"],
  ["GET", "/formatter", "read-metadata"],
  ["GET", "/project", "read-metadata"],
  ["GET", "/project/current", "read-metadata"],
  ["POST", "/project/git/init", "admin"],
  ["PATCH", "/project/:projectID", "config"],
  // The project's configuration and metadata: a project's commands run its start script, and the configuration carries
  // provider keys, base URLs and the commands of MCP servers, so a change of either is the owner's.
  ["GET", "/config", "read-metadata"],
  ["PATCH", "/config", "config"],
  ["GET", "/config/providers", "read-metadata"],
  ["GET", "/agent-skills", "read-metadata"],
  ["POST", "/agent-skills/:toolId/execute", "execute"],
  ["GET", "/event", "read-content"],
  ["GET", "/ws/events", "read-content"],

  // Sessions, messages and the chat: members write to their sessions; the shell and the share upload are not chat.
  ["GET", "/session", "read-content"],
  ["GET", "/session/status", "read-content"],
  ["POST", "/session", "write-content"],
  ["GET", "/session/:sessionID", "read-content"],
  ["PATCH", "/session/:sessionID", "write-content"],
  ["DELETE", "/session/:sessionID", "write-content"],
  ["GET", "/session/:sessionID/children", "read-content"],
  ["GET", "/session/:sessionID/diff", "read-content"],
  ["GET", "/session/:sessionID/todo", "read-content"],
  ["GET", "/session/:sessionID/message", "read-content"],
  ["GET", "/session/:sessionID/message/:messageID", "read-content"],
  ["POST", "/session/:sessionID/message", "write-content"],
  ["DELETE", "/session/:sessionID/message/:messageID", "write-content"],
  ["PATCH", "/session/:sessionID/message/:messageID/part/:partID", "write-content"],
  ["DELETE", "/session/:sessionID/message/:messageID/part/:partID", "write-content"],
  ["POST", "/session/:sessionID/prompt_async", "write-content"],
  ["POST", "/session/:sessionID/command", "write-content"],
  ["POST", "/session/:sessionID/abort", "write-content"],
  ["POST", "/session/:sessionID/fork", "write-content"],
  ["POST", "/session/:sessionID/init", "write-content"],
  ["POST", "/session/:sessionID/revert", "write-content"],
  ["POST", "/session/:sessionID/unrevert", "write-content"],
  ["POST", "/session/:sessionID/summarize", "write-content"],
  ["POST", "/session/:sessionID/permissions/:permissionID", "write-content"],
  ["POST", "/session/:sessionID/shell", "execute"],
  ["POST", "/session/:sessionID/share", "admin"],
  ["DELETE", "/session/:sessionID/share", "admin"],
  ["GET", "/permission", "read-content"],
  ["POST", "/permission/:requestID/reply", "write-content"],
  ["GET", "/question", "read-content"],
  ["POST", "/question/:requestID/reply", "write-content"],
  ["POST", "/question/:requestID/reject", "write-content"],
  ["GET", "/task", "read-content"],
  ["GET", "/task/:id", "read-content"],
  ["GET", "/task/:id/messages", "read-content"],
  ["GET", "/task/:id/team", "read-content"],
  ["POST", "/task/:id/cancel", "write-content"],
  ["POST", "/task/:id/followup", "write-content"],
  ["POST", "/task/:id/promote", "write-content"],
  ["POST", "/task/:id/resume", "write-content"],

  // Providers, debates and teams.
  ["GET", "/provider", "read-metadata"],
  ["GET", "/provider/auth", "read-metadata"],
  ["POST", "/provider/refresh", "admin"],
  ["POST", "/provider/:providerID/oauth/authorize", "credential"],
  ["POST", "/provider/:providerID/oauth/callback", "credential"],
  ["POST", "/debate", "write-content"],
  ["POST", "/debate/estimate", "read-metadata"],
  ["GET", "/debate", "read-content"],
  ["GET", "/debate/:id", "read-content"],
  ["POST", "/debate/:id/feedback", "write-content"],
  ["GET", "/debate/config", "read-metadata"],
  ["PUT", "/debate/config", "admin"],
  ["GET", "/debate/session/:sessionID/config", "read-metadata"],
  ["PUT", "/debate/session/:sessionID/config", "write-content"],
  ["GET", "/team/config", "read-metadata"],
  ["PUT", "/team/config", "admin"],
  ["GET", "/team/runs", "read-content"],
  ["POST", "/team/runs", "write-content"],
  ["GET", "/team/runs/:runID", "read-content"],
  ["GET", "/team/runs/:runID/events", "read-content"],
  ["GET", "/team/runs/:runID/gates", "read-content"],
  ["GET", "/team/runs/:runID/tasks", "read-content"],
  ["GET", "/team/runs/:runID/updates/latest", "read-content"],
  ["POST", "/team/runs/:runID/updates", "write-content"],
  ["POST", "/team/runs/:runID/cancel", "write-content"],
  ["POST", "/team/runs/:runID/pause", "write-content"],
  ["POST", "/team/runs/:runID/resume", "write-content"],
  ["POST", "/team/runs/:runID/tasks/:taskID/status", "write-content"],

  // Knowledge and the model catalogue. The knowledge handlers keep their own rule: the verified admin.
  ["GET", "/knowledge/audit", "admin"],
  ["GET", "/knowledge/doctor", "admin"],
  ["GET", "/knowledge/notes/:id", "admin"],
  ["GET", "/knowledge/notes/:id/backlinks", "admin"],
  ["GET", "/knowledge/search", "admin"],
  ["GET", "/knowledge/status", "admin"],
  ["GET", "/knowledge/tree", "admin"],
  ["GET", "/model-intelligence/models", "read-metadata"],
  ["GET", "/model-intelligence/providers", "read-metadata"],
  ["GET", "/model-intelligence/models/:providerID/:modelID", "read-metadata"],
  ["GET", "/model-intelligence/aliases/:alias", "read-metadata"],
  ["GET", "/model-intelligence/snapshot", "read-metadata"],
  ["GET", "/model-intelligence/licenses", "read-metadata"],
  ["GET", "/model-intelligence/health", "read-metadata"],
  ["POST", "/model-intelligence/sync", "admin"],

  // Observability: the reads and the export are administrative; a change of consent or retention, and the exporter
  // probe that sends an event out, are the owner's.
  ["GET", "/observability/health", "admin"],
  ["GET", "/observability/settings", "admin"],
  ["GET", "/observability/privacy", "admin"],
  ["GET", "/observability/sessions", "admin"],
  ["GET", "/observability/events", "admin"],
  ["GET", "/observability/events/:eventId", "admin"],
  ["GET", "/observability/trace/:traceId", "admin"],
  ["GET", "/observability/summary", "admin"],
  ["GET", "/observability/summary/aggregate", "admin"],
  ["GET", "/observability/compare", "admin"],
  ["GET", "/observability/export", "admin"],
  ["GET", "/observability/exporters/config", "admin"],
  ["GET", "/observability/exporters/preview/:eventId", "admin"],
  ["PUT", "/observability/privacy", "config"],
  ["POST", "/observability/privacy/revoke", "config"],
  ["DELETE", "/observability/data", "config"],
  ["POST", "/observability/exporters/test", "execute"],
  ["GET", "/audit", "admin"],

  // The user's data: the export is a read; the deletion is a write, and the owner's rule for it is not decided here.
  ["GET", "/user/data/export", "read-content"],
  ["DELETE", "/user/data", "write-content"],

  // Experimental: the console and the cross-project lists are administrative. Creating or resetting a worktree or a
  // workspace runs the project's start command, and the create route also runs the body's startCommand: those are the
  // owner's. Switching the Console account changes the token the server uses: a credential.
  ["GET", "/experimental/console", "read-metadata"],
  ["GET", "/experimental/console/orgs", "read-metadata"],
  ["POST", "/experimental/console/switch", "credential"],
  ["GET", "/experimental/tool/ids", "read-metadata"],
  ["GET", "/experimental/tool", "read-metadata"],
  ["GET", "/experimental/resource", "read-metadata"],
  ["GET", "/experimental/session", "admin"],
  ["GET", "/experimental/worktree", "read-metadata"],
  ["POST", "/experimental/worktree", "execute"],
  ["DELETE", "/experimental/worktree", "admin"],
  ["POST", "/experimental/worktree/reset", "execute"],
  ["GET", "/experimental/workspace", "read-metadata"],
  ["POST", "/experimental/workspace", "execute"],
  ["DELETE", "/experimental/workspace/:id", "admin"],

  // Files and search, in the project directory.
  ["GET", "/file", "read-content"],
  ["GET", "/file/content", "read-content"],
  ["GET", "/file/raw", "read-content"],
  ["GET", "/file/status", "read-metadata"],
  ["POST", "/file/write", "write-content"],
  ["POST", "/file/mkdir", "write-content"],
  ["POST", "/file/rename", "write-content"],
  ["POST", "/file/move", "write-content"],
  ["DELETE", "/file", "write-content"],
  ["GET", "/find", "read-content"],
  ["GET", "/find/file", "read-metadata"],
  ["GET", "/find/symbol", "read-metadata"],

  // Git. Staging invokes clean filters, committing invokes hooks, and branch checkout can invoke
  // post-checkout hooks or smudge filters. These are code execution, not member-level file writes.
  // Push/pull run Git with stored credentials and likewise require operator execution authority.
  ["GET", "/git/working-status", "read-metadata"],
  ["GET", "/git/branches", "read-metadata"],
  ["GET", "/git/log", "read-content"],
  ["GET", "/git/blame", "read-content"],
  ["POST", "/git/add", "execute"],
  ["POST", "/git/reset", "write-content"],
  ["POST", "/git/commit", "execute"],
  ["POST", "/git/branch", "execute"],
  ["POST", "/git/push", "execute"],
  ["POST", "/git/pull", "execute"],
  ["GET", "/git/credentials", "credential"],
  ["PUT", "/git/credentials", "credential"],

  // GitHub connection.
  ["GET", "/github/status", "read-metadata"],
  ["GET", "/github/diagnostics", "diagnostic"],
  ["POST", "/github/device/start", "credential"],
  ["POST", "/github/device/poll", "credential"],
  ["POST", "/github/device/cancel", "credential"],
  ["POST", "/github/disconnect", "credential"],
  ["POST", "/github/test-connection", "credential"],

  // Language servers. Rename and code actions edit files; execute-command runs the server's commands.
  ["GET", "/lsp/diagnostics", "read-metadata"],
  ["GET", "/lsp/document-symbol", "read-metadata"],
  ["POST", "/lsp/hover", "read-metadata"],
  ["POST", "/lsp/definition", "read-metadata"],
  ["POST", "/lsp/references", "read-metadata"],
  ["POST", "/lsp/completion", "read-metadata"],
  ["POST", "/lsp/rename", "write-content"],
  ["POST", "/lsp/code-action", "write-content"],
  ["POST", "/lsp/execute-command", "execute"],

  // MCP servers. Adding or removing one changes the configuration; connecting one spawns its command.
  ["GET", "/mcp", "read-metadata"],
  ["POST", "/mcp", "config"],
  ["DELETE", "/mcp/:name", "config"],
  ["POST", "/mcp/:name/connect", "execute"],
  ["POST", "/mcp/:name/disconnect", "execute"],
  ["POST", "/mcp/:name/auth", "credential"],
  ["POST", "/mcp/:name/auth/callback", "credential"],
  ["POST", "/mcp/:name/auth/authenticate", "credential"],
  ["DELETE", "/mcp/:name/auth", "credential"],

  // Terminals: a PTY runs a command as the owner does, and its output and its input are the owner's.
  ["GET", "/pty", "execute"],
  ["POST", "/pty", "execute"],
  ["GET", "/pty/:ptyID", "execute"],
  ["PUT", "/pty/:ptyID", "execute"],
  ["DELETE", "/pty/:ptyID", "execute"],
  ["GET", "/pty/:ptyID/tail", "execute"],
  ["GET", "/pty/:ptyID/connect", "execute"],

  // The TUI's remote control: the commands it runs and the control channel are the owner's; the UI actions are chat.
  ["GET", "/tui/control/next", "execute"],
  ["POST", "/tui/control/response", "execute"],
  ["POST", "/tui/execute-command", "execute"],
  ["POST", "/tui/submit-prompt", "execute"],
  ["POST", "/tui/append-prompt", "write-content"],
  ["POST", "/tui/clear-prompt", "write-content"],
  ["POST", "/tui/open-help", "write-content"],
  ["POST", "/tui/open-models", "write-content"],
  ["POST", "/tui/open-sessions", "write-content"],
  ["POST", "/tui/open-themes", "write-content"],
  ["POST", "/tui/select-session", "write-content"],
  ["POST", "/tui/show-toast", "write-content"],
  ["POST", "/tui/publish", "write-content"],
]
