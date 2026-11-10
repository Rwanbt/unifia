import { describe, it, expect } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"
import { redact, scanMessages } from "../../src/security/dlp"

// scanMessages gates on experimental.dlp.enabled, read from the project config.
// The flag is injected through UNIFIA_CONFIG_CONTENT (a config source) inside a
// project instance: a bare unit process has no config, so DLP would stay off
// (the config-schema default) and the scan cases could not be exercised.
const previous = process.env["UNIFIA_CONFIG_CONTENT"]

async function withDlp<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  process.env["UNIFIA_CONFIG_CONTENT"] = JSON.stringify({ experimental: { dlp: { enabled } } })
  await Config.invalidate(true)
  try {
    await using tmp = await tmpdir()
    return await Instance.provide({ directory: tmp.path, fn })
  } finally {
    if (previous === undefined) delete process.env["UNIFIA_CONFIG_CONTENT"]
    else process.env["UNIFIA_CONFIG_CONTENT"] = previous
    await Config.invalidate(true)
  }
}

describe("DLP redaction", () => {
  it("redacts AWS access key IDs", () => {
    const result = redact("key = AKIAIOSFODNN7EXAMPLE")
    expect(result.text).toContain("[REDACTED:AWS_KEY]")
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(result.redactions).toBe(1)
  })

  it("redacts GitHub tokens", () => {
    const result = redact("using ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 for auth")
    expect(result.text).toContain("[REDACTED:GITHUB_TOKEN]")
    expect(result.redactions).toBeGreaterThanOrEqual(1)
  })

  it("redacts Stripe keys", () => {
    // Build the test token dynamically to avoid GitHub push protection
    const prefix = "sk" + "_" + "live" + "_"
    const result = redact("STRIPE_KEY=" + prefix + "x".repeat(24))
    expect(result.text).toContain("[REDACTED:STRIPE_KEY]")
    expect(result.redactions).toBe(1)
  })

  it("redacts Slack tokens", () => {
    const result = redact("const token = 'xoxb-1234567890-abcdefghij'")
    expect(result.text).toContain("[REDACTED:SLACK_TOKEN]")
    expect(result.redactions).toBe(1)
  })

  it("redacts private key blocks", () => {
    const result = redact("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----")
    expect(result.text).toContain("[REDACTED:PRIVATE_KEY]")
    expect(result.text).not.toContain("MIIEpAIBAAKCAQEA")
    expect(result.redactions).toBe(1)
  })

  it("redacts database connection strings", () => {
    const result = redact("DATABASE_URL=postgres://user:pass@host:5432/db")
    expect(result.text).toContain("[REDACTED:DATABASE_URL]")
    expect(result.redactions).toBe(1)
  })

  it("redacts JWT tokens", () => {
    const result = redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456")
    expect(result.text).toContain("[REDACTED:JWT]")
    expect(result.redactions).toBe(1)
  })

  it("handles multiple redactions in same text", () => {
    const stripeKey = "sk" + "_" + "live" + "_" + "x".repeat(24)
    const result = redact("aws AKIAIOSFODNN7EXAMPLE and " + stripeKey)
    expect(result.redactions).toBeGreaterThanOrEqual(2)
    expect(result.findings.length).toBeGreaterThanOrEqual(2)
  })

  it("returns unchanged text when no secrets found", () => {
    const input = "const x = 42; function hello() { return 'world' }"
    const result = redact(input)
    expect(result.text).toBe(input)
    expect(result.redactions).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it("findings contain rule details", () => {
    const result = redact("AKIAIOSFODNN7EXAMPLE")
    expect(result.findings[0].rule).toBe("aws-access-key")
    expect(result.findings[0].description).toBe("AWS access key ID")
    expect(result.findings[0].count).toBe(1)
  })

  it("blocks secrets inside SDK tool-result text, content arrays, and nested JSON without mutating inputs", async () => {
    const token = "gh" + "p_" + "A".repeat(36)
    const messages = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call-1", toolName: "bash", output: { type: "text", value: token } },
          {
            type: "tool-result",
            toolCallId: "call-2",
            toolName: "webfetch",
            output: {
              type: "content",
              value: [
                { type: "text", text: "credentials: " + token },
                { type: "media", mediaType: "image/png", data: "YQ==" },
              ],
            },
          },
          {
            type: "tool-result",
            toolCallId: "call-3",
            toolName: "custom",
            output: { type: "json", value: { nested: [{ credential: token }, { safe: "public" }] } },
          },
        ],
      },
    ]
    const before = structuredClone(messages)
    const result = await withDlp(true, () => scanMessages(messages))

    expect(result.totalRedactions).toBe(3)
    expect(JSON.stringify(result.messages)).not.toContain(token)
    expect(result.findings).toEqual([{ rule: "github-token", description: "GitHub personal access token", count: 3 }])
    expect(result.messages).toEqual(
      before.map((msg) => ({
        ...msg,
        content: msg.content.map((part) => ({
          ...part,
          output: JSON.parse(JSON.stringify(part.output).replaceAll(token, "[REDACTED:GITHUB_TOKEN]")),
        })),
      })),
    )
    expect(messages).toEqual(before)
    expect(result.messages[0]).not.toBe(messages[0])
  })

  it("allows safe SDK tool results unchanged with no false redaction", async () => {
    const media = "QUJD".repeat(10)
    const messages = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call-4", toolName: "bash", output: { type: "text", value: "all good" } },
          { type: "tool-result", toolCallId: "call-5", toolName: "read", output: { type: "json", value: { ok: true, lines: ["public", "safe"] } } },
          { type: "tool-result", toolCallId: "call-7", toolName: "browser", output: { type: "content", value: [{ type: "media", mediaType: "image/png", data: media }] } },
        ],
      },
    ]
    const result = await withDlp(true, () => scanMessages(messages))
    expect(result.messages).toEqual(messages)
    expect(result.totalRedactions).toBe(0)
    expect(result.findings).toEqual([])
  })

  it("blocks project-scoped OpenAI keys from direct text and nested tool results", async () => {
    const key = "sk-" + "proj-" + "A".repeat(50)
    expect(redact(key).text).toBe("[REDACTED:OPENAI_KEY]")
    const result = await withDlp(true, () =>
      scanMessages([
        { role: "tool", content: [{ type: "tool-result", toolCallId: "call-6", toolName: "read", output: { type: "json", value: { token: key } } }] },
      ]),
    )
    expect(result.totalRedactions).toBe(1)
    expect(JSON.stringify(result.messages)).not.toContain(key)
    expect(JSON.stringify(result.messages)).toContain("[REDACTED:OPENAI_KEY]")
  })

  // Regression pair for the `js/missing-await` defect: the enable flag used to be
  // read without awaiting, so this "disabled" branch was dead and every project
  // redacted regardless of `experimental.dlp.enabled`.
  it("rewrites nothing when a project disables DLP", async () => {
    const token = "gh" + "p_" + "B".repeat(36)
    const messages = [
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "call-off", toolName: "bash", output: { type: "text", value: token } }],
      },
    ]
    const before = structuredClone(messages)
    const result = await withDlp(false, () => scanMessages(messages))

    expect(result.totalRedactions).toBe(0)
    expect(result.findings).toEqual([])
    expect(result.messages).toBe(messages)
    expect(messages).toEqual(before)
    expect(JSON.stringify(result.messages)).toContain(token)
  })

  it("redacts the same payload when a project enables DLP", async () => {
    const token = "gh" + "p_" + "C".repeat(36)
    const messages = [
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "call-on", toolName: "bash", output: { type: "text", value: token } }],
      },
    ]
    const result = await withDlp(true, () => scanMessages(messages))

    expect(result.totalRedactions).toBe(1)
    expect(JSON.stringify(result.messages)).not.toContain(token)
    expect(JSON.stringify(result.messages)).toContain("[REDACTED:GITHUB_TOKEN]")
  })
})
