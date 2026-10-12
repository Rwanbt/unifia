// Child process used by run.test.ts. It is not a test file: bun test does not collect it.
//   crash <root>   create a run and a fixture in <root>, print them, then wait to be killed
//   end <root>     create a run with one leftover fixture in <root>, print it, then exit normally (the run ends)
import * as fs from "node:fs"
import * as path from "node:path"
import { createRun } from "./run"

const [mode, root] = process.argv.slice(2)
if (!mode || !root) {
  console.error("usage: run-child.ts <crash|end> <root>")
  process.exit(2)
}

if (mode === "crash") {
  const run = createRun({ root })
  const fixture = path.join(run.path, "unifia-test-crash")
  fs.mkdirSync(fixture)
  console.log(JSON.stringify({ run: run.path, createdAt: run.owner.createdAt, fixture }))
  setInterval(() => {}, 1000)
} else if (mode === "end") {
  const run = createRun({ root })
  const fixture = path.join(run.path, "unifia-test-left")
  fs.mkdirSync(fixture)
  console.log(JSON.stringify({ run: run.path, owner: run.owner, fixture }))
} else {
  console.error(`unknown mode: ${mode}`)
  process.exit(2)
}
