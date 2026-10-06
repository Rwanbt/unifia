// Fake LSP server that answers `initialize` and then exits on its own.
// Models an LSP server that dies mid-session without a shutdown request, without
// an `exit` notification and without writing to stderr, so the only signal the
// client gets is the transport going away. Used by test/lsp/client-dead-server.test.ts.

let nextId = 1

function encode(message) {
  const json = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`
  return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(json, "utf8")])
}

function decodeFrames(buffer) {
  const results = []
  let idx
  while ((idx = buffer.indexOf("\r\n\r\n")) !== -1) {
    const header = buffer.slice(0, idx).toString("utf8")
    const m = /Content-Length:\s*(\d+)/i.exec(header)
    const len = m ? parseInt(m[1], 10) : 0
    const bodyStart = idx + 4
    const bodyEnd = bodyStart + len
    if (buffer.length < bodyEnd) break
    results.push(buffer.slice(bodyStart, bodyEnd).toString("utf8"))
    buffer = buffer.slice(bodyEnd)
  }
  return { messages: results, rest: buffer }
}

let readBuffer = Buffer.alloc(0)

process.stdin.on("data", (chunk) => {
  readBuffer = Buffer.concat([readBuffer, chunk])
  const { messages, rest } = decodeFrames(readBuffer)
  readBuffer = rest
  for (const raw of messages) handle(raw)
})

function send(msg) {
  process.stdout.write(encode(msg))
}

function handle(raw) {
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  if (data.method === "initialize") {
    send({ jsonrpc: "2.0", id: data.id, result: { capabilities: {} } })
    // Die on our own, once the handshake is complete. Nothing is printed to
    // stderr and no shutdown/exit is received: the process simply disappears.
    const delay = Number.parseInt(process.env.FAKE_LSP_EXIT_DELAY_MS ?? "120", 10)
    setTimeout(() => process.exit(0), Number.isFinite(delay) ? delay : 120)
    return
  }
  if (typeof data.id !== "undefined") {
    send({ jsonrpc: "2.0", id: data.id, result: null })
    return
  }
}
