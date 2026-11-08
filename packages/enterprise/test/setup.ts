// SPDX-License-Identifier: MIT
// Hermetic S3 adapter at the HTTP boundary. No real network, cloud credentials,
// or persistent state. Production Storage and Share code remain unmodified.
const objects = new Map<string, string>()
process.env.OPENCODE_STORAGE_ADAPTER = "s3"
process.env.OPENCODE_STORAGE_BUCKET = "unit-tests"
process.env.OPENCODE_STORAGE_REGION = "us-east-1"
process.env.OPENCODE_STORAGE_ACCESS_KEY_ID = "unit-test-key"
process.env.OPENCODE_STORAGE_SECRET_ACCESS_KEY = "unit-test-secret"

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(input, init)
  const url = new URL(request.url)
  if (url.origin !== "https://s3.us-east-1.amazonaws.com" || !url.pathname.startsWith("/unit-tests")) {
    throw new Error("Unexpected external network request during enterprise unit tests: " + url.href)
  }
  if (url.pathname === "/unit-tests" && url.searchParams.get("list-type") === "2") {
    const prefix = url.searchParams.get("prefix") ?? ""
    const after = url.searchParams.get("start-after") ?? ""
    const limit = Number(url.searchParams.get("max-keys") || "10000")
    const keys = [...objects.keys()].filter((key) => key.startsWith(prefix) && key > after)
      .sort((a, b) => a.localeCompare(b)).slice(0, limit)
    return new Response("<ListBucketResult>" + keys.map((key) => "<Contents><Key>" + key + "</Key></Contents>").join("") + "</ListBucketResult>", {
      status: 200, headers: { "Content-Type": "application/xml" },
    })
  }
  const key = decodeURIComponent(url.pathname.slice("/unit-tests/".length))
  if (!key || !url.pathname.startsWith("/unit-tests/")) throw new Error("Invalid unit-test S3 key")
  if (request.method === "PUT") {
    objects.set(key, await request.text())
    return new Response("", { status: 200 })
  }
  if (request.method === "GET") {
    const value = objects.get(key)
    return value === undefined ? new Response("", { status: 404 }) : new Response(value, { status: 200 })
  }
  if (request.method === "DELETE") {
    objects.delete(key)
    return new Response("", { status: 204 })
  }
  throw new Error("Unexpected unit-test S3 method: " + request.method)
}
