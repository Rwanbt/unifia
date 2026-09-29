/* SPDX-License-Identifier: MIT */

// The MCP page's suggested integrations (the reference's catalog). Each entry
// is a template for the add form -- remote URL or local command -- that the
// user reviews before anything is added; nothing here connects on its own.

export type McpCategory = "dev" | "productivity" | "data" | "web"

export type McpTemplate = {
  id: string
  name: string
  logo: string
  category: McpCategory
  transport: "remote" | "local"
  /** Remote URL, or the local command line (split on spaces when added). */
  target: string
}

export const MCP_CATEGORIES: McpCategory[] = ["dev", "productivity", "data", "web"]

export const MCP_CATALOG: McpTemplate[] = [
  {
    id: "github",
    name: "GitHub",
    logo: "GH",
    category: "dev",
    transport: "remote",
    target: "https://api.githubcopilot.com/mcp/",
  },
  {
    id: "notion",
    name: "Notion",
    logo: "N",
    category: "productivity",
    transport: "remote",
    target: "https://mcp.notion.com/mcp",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    logo: "FS",
    category: "dev",
    transport: "local",
    target: "npx -y @modelcontextprotocol/server-filesystem .",
  },
  { id: "git", name: "Git", logo: "Git", category: "dev", transport: "local", target: "uvx mcp-server-git" },
  {
    id: "postgres",
    name: "PostgreSQL",
    logo: "PG",
    category: "data",
    transport: "local",
    target: "npx -y @modelcontextprotocol/server-postgres postgresql://localhost/postgres",
  },
  {
    id: "sqlite",
    name: "SQLite",
    logo: "SQ",
    category: "data",
    transport: "local",
    target: "uvx mcp-server-sqlite --db-path ./data.db",
  },
  {
    id: "linear",
    name: "Linear",
    logo: "LI",
    category: "productivity",
    transport: "remote",
    target: "https://mcp.linear.app/sse",
  },
  {
    id: "playwright",
    name: "Browser / Playwright",
    logo: "PW",
    category: "web",
    transport: "local",
    target: "npx @playwright/mcp@latest",
  },
  {
    id: "sentry",
    name: "Sentry",
    logo: "SE",
    category: "web",
    transport: "remote",
    target: "https://mcp.sentry.dev/mcp",
  },
  { id: "fetch", name: "Fetch", logo: "FE", category: "web", transport: "local", target: "uvx mcp-server-fetch" },
]
