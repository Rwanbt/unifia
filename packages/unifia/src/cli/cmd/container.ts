/* SPDX-License-Identifier: MIT */
// `unifia container` — rootless containers from OCI images, run under PRoot
// (ADR-098). Docker vocabulary, but not Docker Engine: no kernel isolation,
// and a container shares the app's network.
import type { Argv } from "yargs"
import { Global } from "../../global"
import { containerLocation, DEFAULT_CONTAINER_QUOTA_BYTES } from "../../container/defaults"
import { RegistryClient } from "../../container/registry"
import { ContainerRuntime } from "../../container/runtime"
import { ImageStore } from "../../container/store"
import { cmd } from "./cmd"

interface ContainerArgs {
  action: string
  args: string[]
  name?: string
  env?: string[]
  workdir?: string
  state?: string
  proot?: string
}

const RUN_OPTIONS_WITH_VALUE = new Set(["--name", "--env", "-e", "--workdir", "-w", "--state", "--proot"])

// docker run [OPTIONS] IMAGE [COMMAND...]: options only before the image, and the
// command after it is passed verbatim, so `node -e '...'` keeps its own -e.
export function splitRunArguments(argv: readonly string[]): { image: string; command: string[] } {
  let index = argv.indexOf("run") + 1
  while (index < argv.length && argv[index]!.startsWith("-")) {
    index += RUN_OPTIONS_WITH_VALUE.has(argv[index]!) ? 2 : 1
  }
  const image = argv[index]
  if (!image) throw new Error("container run needs an image")
  return { image, command: argv.slice(index + 1) }
}

function open(args: ContainerArgs) {
  const location = containerLocation(Global.Path.data)
  const state = args.state ?? location.state
  const store = new ImageStore({ state, architecture: location.architecture, quotaBytes: DEFAULT_CONTAINER_QUOTA_BYTES, client: new RegistryClient() })
  const runtime = new ContainerRuntime({ state, store, proot: args.proot ?? location.proot, loader: location.loader })
  return { store, runtime }
}

async function run(args: ContainerArgs): Promise<unknown> {
  const { store, runtime } = open(args)
  const [first] = args.args
  const need = () => {
    if (!first) throw new Error(`container ${args.action} needs an argument`)
    return first
  }
  if (args.action === "images") return store.images()
  if (args.action === "ps") return runtime.list()
  if (args.action === "pull") return store.pull(need())
  if (args.action === "rmi") return store.remove(need())
  if (args.action === "rm") return runtime.remove(need())
  // yargs may have read options that belong to the container command; take it from argv.
  const { image, command } = splitRunArguments(process.argv)
  const record = await runtime.run(image, { command, name: args.name, env: args.env, workdir: args.workdir }, (chunk) => process.stdout.write(chunk))
  process.exitCode = record.exitCode
  return undefined
}

export const ContainerCommand = cmd({
  command: "container <action> [args..]",
  describe: "pull OCI images and run rootless containers under PRoot (no kernel isolation)",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", { choices: ["pull", "run", "images", "rmi", "ps", "rm"], type: "string" })
      .positional("args", { type: "string", array: true, default: [] })
      .option("name", { type: "string", describe: "container name (run)" })
      .option("env", { alias: "e", type: "string", array: true, describe: "KEY=VALUE (run)" })
      .option("workdir", { alias: "w", type: "string", describe: "working directory inside the container (run)" })
      .option("state", { type: "string", describe: "container state directory" })
      .option("proot", { type: "string", describe: "PRoot binary" })
      .parserConfiguration({ "unknown-options-as-args": true }),
  handler: async (args) => {
    const result = await run(args as unknown as ContainerArgs)
    if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  },
})
