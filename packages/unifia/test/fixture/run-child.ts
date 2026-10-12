// Child process used by run.test.ts. It is not a test file: bun test does not collect it.
//   crash <root>         create a run and a fixture in <root>, then wait to be killed
//   sweep <root> <ms>    create a run in <root>, sweep <root> repeatedly for <ms>, then exit
//   retain <root>        create a run with one leftover fixture, then exit normally (the run ends)
import * as fs from "node:fs"
import * as path from "node:path"
import { createRun, sweepAbandoned } from "./run"

const [mode, root, ms] = process.argv.slice(2)
if (!mode || !root) {
  console.error("usage: run-child.ts <crash|sweep|retain> <root> [ms]")
  process.exit(2)
}

if (mode === "crash") {
  const run = createRun({ root })
  const fixture = path.join(run.path, "unifia-test-crash")
  fs.mkdirSync(fixture)
  console.log(JSON.stringify({ run: run.path, createdAt: run.owner.createdAt, fixture }))
  setInterval(() => {}, 1000)
} else if (mode === "retain") {
  const run = createRun({ root })
  const fixture = path.join(run.path, "unifia-test-left")
  fs.mkdirSync(fixture)
  console.log(JSON.stringify({ run: run.path, fixture }))
} else if (mode === "sweep") {
  const run = createRun({ root })
  fs.mkdirSync(path.join(run.path, "unifia-test-own"))
  const until = Date.now() + Number(ms ?? "1000")
  let overlap = 0
  while (Date.now() < until) {
    const others = fs.readdirSync(root).filter((name) => name.startsWith("run-") && path.join(root, name) !== run.path)
    if (others.length > 0) overlap++
    sweepAbandoned({ root, graceMs: 0 })
    if (!fs.existsSync(run.path)) {
      console.log(JSON.stringify({ error: "own run directory was removed by another process" }))
      process.exit(3)
    }
    await Bun.sleep(5)
  }
  console.log(JSON.stringify({ done: true, overlap }))
} else {
  console.error(`unknown mode: ${mode}`)
  process.exit(2)
}
