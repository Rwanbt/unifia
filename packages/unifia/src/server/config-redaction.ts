/**
 * Secrets in the configuration, for every response and every write.
 *
 * A configuration read returns the placeholder in place of each secret, for every caller, the owner included, so a
 * settings screen or a log can show that a secret is set without showing it. A write that sends the placeholder back
 * leaves the stored value as it is: the placeholder is removed from the write before it reaches the file, so it can
 * never become a value.
 */

/** The value every secret reads as. */
export const REDACTED = "[redacted]"

/** A key whose string value is a secret, at any depth: `jwt_secret`, `apiKey`, `api_key`, `clientSecret`, `token`. */
const SECRET_KEY = /(secret|password|passwd|api_?key|access_?token|refresh_?token|private_?key|token)$/i

/** A record whose every value is a secret: configured HTTP headers and the environment of a local server. */
const SECRET_RECORDS = new Set(["headers", "environment"])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, typeof value === "string" && value !== "" ? REDACTED : value]),
  )
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (SECRET_RECORDS.has(key) && isPlainObject(child)) return [key, redactRecord(child)]
      if (SECRET_KEY.test(key) && typeof child === "string" && child !== "") return [key, REDACTED]
      return [key, redact(child)]
    }),
  )
}

/** The configuration as a response may show it: every secret replaced by the placeholder. */
export function redactConfig<T>(config: T): T {
  return redact(config) as T
}

function withoutPlaceholders(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== REDACTED).map(withoutPlaceholders)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== REDACTED)
      .map(([key, child]) => [key, withoutPlaceholders(child)]),
  )
}

/**
 * A configuration write as the file may take it: every placeholder removed. A key that held the placeholder is absent
 * from the write, so the merge keeps the stored value. The placeholder is never written.
 */
export function withoutRedactedValues<T>(config: T): T {
  return withoutPlaceholders(config) as T
}
