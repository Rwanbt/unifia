// Child process used by run.test.ts. It is not a test file: bun test does not collect it.
//   end <root>   create a run with one leftover fixture in <root>, print it, then exit normally (the run ends)
import * as fs from "node:fs"
import * as path from "node:path"
import { createRun } from "./run"

const [mode, root] = process.argv.slice(2)
if (!mode || !root) {
  console.error("usage: run-child.ts end <root>")
  process.exit(2)
}

if (mode === "end") {
  const run = createRun({ root })
  const fixture = path.join(run.path, "unifia-test-left")
  fs.mkdirSync(fixture)
  console.log(JSON.stringify({ run: run.path, owner: run.owner, fixture }))
} else {
  console.error(`unknown mode: ${mode}`)
  process.exit(2)
}
