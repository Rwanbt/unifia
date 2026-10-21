// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

/**
 * Live qualification of the pinned toolchains, from their real sources.
 *
 * Each test downloads the real artifact (npm registry or Go module proxy), verifies it against the
 * pinned size and digest, installs it, executes it, and exercises update, rollback and removal.
 * It needs network access and about 250 MB of disk per platform, so it runs only with
 * UNIFIA_TOOLCHAIN_LIVE=1. The CI test job does not set it.
 *
 * UNIFIA_TOOLCHAIN_PLATFORM selects the artifact (default linux-x64). UNIFIA_TOOLCHAIN_LAUNCHER is a
 * JSON array prepended to every execution, for running a non-native binary under an emulator, for
 * example ["qemu-aarch64-static","-L","/usr/aarch64-linux-gnu"] on an x86_64 host.
 */
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { parse, type Entry, type Platform } from "../../src/toolchain/catalog"
import { pinned } from "../../src/toolchain/data"
import { capture } from "../../src/toolchain/exec"
import { execute, installEntry, remove, rollback, status, type Config } from "../../src/toolchain/store"
import { packages as gitArm64 } from "../../src/toolchain/locks/git-linux-arm64"
import { packages as gitX64 } from "../../src/toolchain/locks/git-linux-x64"
import { packages as pythonArm64 } from "../../src/toolchain/locks/python3-linux-arm64"
import { packages as pythonX64 } from "../../src/toolchain/locks/python3-linux-x64"
import { packages as javaArm64 } from "../../src/toolchain/locks/openjdk-17-linux-arm64"
import { packages as rubyArm64 } from "../../src/toolchain/locks/ruby-linux-arm64"
import { packages as rubyX64 } from "../../src/toolchain/locks/ruby-linux-x64"
import { packages as phpArm64 } from "../../src/toolchain/locks/php-linux-arm64"
import { packages as phpX64 } from "../../src/toolchain/locks/php-linux-x64"
import { packages as javaX64 } from "../../src/toolchain/locks/openjdk-17-linux-x64"
import { packages as sqliteArm64 } from "../../src/toolchain/locks/sqlite3-linux-arm64"
import { packages as sqliteX64 } from "../../src/toolchain/locks/sqlite3-linux-x64"
import { packages as curlArm64 } from "../../src/toolchain/locks/curl-linux-arm64"
import { packages as curlX64 } from "../../src/toolchain/locks/curl-linux-x64"
import { packages as sshArm64 } from "../../src/toolchain/locks/openssh-client-linux-arm64"
import { packages as sshX64 } from "../../src/toolchain/locks/openssh-client-linux-x64"
import { packages as makeArm64 } from "../../src/toolchain/locks/make-linux-arm64"
import { packages as makeX64 } from "../../src/toolchain/locks/make-linux-x64"
import { packages as cmakeArm64 } from "../../src/toolchain/locks/cmake-linux-arm64"
import { packages as cmakeX64 } from "../../src/toolchain/locks/cmake-linux-x64"

const live = process.env.UNIFIA_TOOLCHAIN_LIVE === "1"
const platform = (process.env.UNIFIA_TOOLCHAIN_PLATFORM ?? "linux-x64") as Platform
const launcher: string[] = JSON.parse(process.env.UNIFIA_TOOLCHAIN_LAUNCHER ?? "[]")
const TIMEOUT_MS = 1_200_000

// The previous Bun pin, used as the update target. Sizes and sha512 were measured from the artifacts.
const bunPrevious = parse([
  {
    id: "bun",
    name: "Bun",
    version: "1.3.10",
    license: "MIT",
    bins: ["bun"],
    probe: { args: ["--version"], expect: "1.3.10" },
    artifacts: [
      {
        platform: "linux-x64",
        url: "https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.3.10.tgz",
        archive: "tar.gz",
        prefix: "package",
        size: 40181985,
        sha512: "sha512-bzUgYj/PIZziB/ZesIP9HUyfvh6Vlf3od+TrbTTyVEuCSMKzDPQVW/yEbRp0tcHO3alwiEXwJDrWrHAguXlgiQ==",
      },
      {
        platform: "linux-arm64",
        url: "https://registry.npmjs.org/@oven/bun-linux-aarch64/-/bun-linux-aarch64-1.3.10.tgz",
        archive: "tar.gz",
        prefix: "package",
        size: 40151387,
        sha512: "sha512-OUgPHfL6+PM2Q+tFZjcaycN3D7gdQdYlWnwMI31DXZKY1r4HINWk9aEz9t/rNaHg65edwNrt7dsv9TF7xK8xIA==",
      },
    ],
  },
])[0]!

const entry = (id: string) => pinned.find((item) => item.id === id)!

async function config(dir: string): Promise<Config> {
  return { root: path.join(dir, "toolchains"), platform, launcher, budget: 2_000_000_000 }
}

test.skipIf(!live)(
  "bun is installed from its registry artifact, executed, updated, rolled back and removed",
  async () => {
    await using tmp = await tmpdir()
    const cfg = await config(tmp.path)

    expect(await installEntry(cfg, entry("bun"))).toBe("installed")
    const first = await execute(cfg, "bun", "bun", ["--version"])
    expect(first.stdout.trim()).toBe("1.3.11")

    expect(await installEntry(cfg, bunPrevious)).toBe("installed")
    expect(await status(cfg, "bun")).toEqual({ current: "1.3.10", previous: "1.3.11", versions: ["1.3.10", "1.3.11"] })
    expect((await execute(cfg, "bun", "bun", ["--version"])).stdout.trim()).toBe("1.3.10")

    await rollback(cfg, "bun")
    expect((await execute(cfg, "bun", "bun", ["--version"])).stdout.trim()).toBe("1.3.11")

    await remove(cfg, "bun", "1.3.10")
    await remove(cfg, "bun", "1.3.11")
    expect(await status(cfg, "bun")).toEqual({ current: undefined, previous: undefined, versions: [] })
    await expect(execute(cfg, "bun", "bun", ["--version"])).rejects.toThrow("not installed")
  },
  TIMEOUT_MS,
)

test.skipIf(!live)(
  "go is installed from the module proxy, verified against sum.golang.org, and compiles a program",
  async () => {
    await using tmp = await tmpdir()
    const cfg = await config(tmp.path)
    expect(await installEntry(cfg, entry("go"))).toBe("installed")
    expect((await execute(cfg, "go", "go", ["version"])).stdout).toContain("go1.27.3")

    const project = path.join(tmp.path, "project")
    await Bun.write(path.join(project, "main.go"), 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("hello from go") }\n')
    const env = { GOTELEMETRY: "off", GOCACHE: path.join(tmp.path, "gocache"), GOPATH: path.join(tmp.path, "gopath") }
    // A cold build under emulation takes minutes, far beyond the default probe timeout.
    const build = await execute(cfg, "go", "go", ["build", "-o", "hello", "main.go"], {
      cwd: project,
      env,
      timeout: 900_000,
    })
    expect(build.code).toBe(0)

    const run = await capture([...launcher, path.join(project, "hello")])
    expect(run.stdout.trim()).toBe("hello from go")

    await remove(cfg, "go", "1.27.3")
    expect((await status(cfg, "go")).versions).toEqual([])
  },
  TIMEOUT_MS,
)

test.skipIf(!live)(
  "node is installed from nodejs.org, runs its bundled npm and reports the architecture it was built for",
  async () => {
    await using tmp = await tmpdir()
    const cfg = await config(tmp.path)
    expect(await installEntry(cfg, entry("node"))).toBe("installed")
    expect((await execute(cfg, "node", "node", ["--version"])).stdout.trim()).toBe("v24.22.1")

    const npmCli = path.join(cfg.root, "node", "current", "lib", "node_modules", "npm", "bin", "npm-cli.js")
    expect((await execute(cfg, "node", "node", [npmCli, "--version"], { timeout: 300_000 })).code).toBe(0)

    const arch = platform === "linux-arm64" ? "arm64" : "x64"
    const probe = await execute(cfg, "node", "node", ["-e", "console.log(process.arch)"])
    expect(probe.stdout.trim()).toBe(arch)

    await remove(cfg, "node", "24.22.1")
    expect((await status(cfg, "node")).versions).toEqual([])
  },
  TIMEOUT_MS,
)

// Python 3 and Git are installed from their signed Ubuntu locks. They are NOT in the product catalog:
// their dependency closure carries licences outside the ADR-027 allowlist (PSF-2.0, GPL and Artistic
// perl, zlib, curl), which needs an ADR exception that the owner has not granted. This test therefore
// builds the entries directly, without parse(), and says so. It proves the engine, not a shipped toolchain.
const pendingLicence = "PENDING ADR-027 exception: qualification only, not in the product catalog"
const debEntry = (id: string, version: string, bins: string[], expect: string, artifact: { platform: Platform; packages: Entry["artifacts"][number]["packages"] }, args = ["--version"], bindir = "usr/bin", vars: Record<string, string[]> = {}) =>
  ({
    id,
    name: id,
    version,
    license: pendingLicence,
    bindir,
    bins,
    libdirs: ["usr/lib/aarch64-linux-gnu", "usr/lib/x86_64-linux-gnu", "usr/lib"],
    depends: [],
    env: vars,
    probe: { args, expect },
    artifacts: [{ platform: artifact.platform, archive: "deb-set", prefix: ".", packages: artifact.packages }],
  }) as unknown as Entry

const pythonPackages = platform === "linux-arm64" ? pythonArm64 : pythonX64
const gitPackages = platform === "linux-arm64" ? gitArm64 : gitX64

test.skipIf(!live)(
  "python3 is installed from its signed Ubuntu packages, runs, and computes with its standard library",
  async () => {
    await using tmp = await tmpdir()
    const cfg = await config(tmp.path)
    const python = debEntry("python3", "3.12.3", ["python3"], "Python 3.12.3", { platform, packages: pythonPackages })
    expect(await installEntry(cfg, python)).toBe("installed")
    expect((await execute(cfg, "python3", "python3", ["--version"])).stdout.trim()).toBe("Python 3.12.3")
    const run = await execute(cfg, "python3", "python3", ["-c", "import hashlib, json; print(json.dumps(hashlib.sha256(b'unifia').hexdigest()))"])
    expect(JSON.parse(run.stdout.trim())).toMatch(/^[0-9a-f]{64}$/)
    await remove(cfg, "python3", "3.12.3")
  },
  TIMEOUT_MS,
)

test.skipIf(!live)(
  "git is installed from its signed Ubuntu packages and records a commit in a real repository",
  async () => {
    await using tmp = await tmpdir()
    const cfg = await config(tmp.path)
    const git = debEntry("git", "2.43.0", ["git"], "git version 2.43.0", { platform, packages: gitPackages })
    expect(await installEntry(cfg, git)).toBe("installed")
    expect((await execute(cfg, "git", "git", ["--version"])).stdout.trim()).toBe("git version 2.43.0")
    const repo = path.join(tmp.path, "repo")
    await mkdir(repo, { recursive: true })
    const env = { HOME: tmp.path, GIT_CONFIG_NOSYSTEM: "1" }
    expect((await execute(cfg, "git", "git", ["init", "-q"], { cwd: repo, env })).code).toBe(0)
    const commit = await execute(cfg, "git", "git", ["-c", "user.name=unifia", "-c", "user.email=unifia@example.invalid", "commit", "-q", "--allow-empty", "-m", "first"], { cwd: repo, env })
    expect(commit.code).toBe(0)
    expect((await execute(cfg, "git", "git", ["log", "--format=%s"], { cwd: repo, env })).stdout.trim()).toBe("first")
    await remove(cfg, "git", "2.43.0")
  },
  TIMEOUT_MS,
)

// The same pending entries for five more Debian tools, each proven by a real action.
const pick = (arm: unknown, x64: unknown) => (platform === "linux-arm64" ? arm : x64) as Entry["artifacts"][number]["packages"]

test.skipIf(!live)("sqlite3 is installed from its signed packages and runs a query", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const sqlite = debEntry("sqlite3", "3.45.1", ["sqlite3"], "3.45.1", { platform, packages: pick(sqliteArm64, sqliteX64) })
  expect(await installEntry(cfg, sqlite)).toBe("installed")
  expect((await execute(cfg, "sqlite3", "sqlite3", ["--version"])).stdout).toContain("3.45.1")
  expect((await execute(cfg, "sqlite3", "sqlite3", [":memory:", "select 6*7;"])).stdout.trim()).toBe("42")
  await remove(cfg, "sqlite3", "3.45.1")
}, TIMEOUT_MS)

test.skipIf(!live)("curl is installed from its signed packages and reads a file through file://", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const curl = debEntry("curl", "8.5.0", ["curl"], "curl 8.5.0", { platform, packages: pick(curlArm64, curlX64) })
  expect(await installEntry(cfg, curl)).toBe("installed")
  const file = path.join(tmp.path, "payload.txt")
  await Bun.write(file, "from curl\n")
  expect((await execute(cfg, "curl", "curl", ["-s", `file://${file}`])).stdout).toBe("from curl\n")
  await remove(cfg, "curl", "8.5.0")
}, TIMEOUT_MS)

test.skipIf(!live)("openssh-client is installed and generates an ed25519 key pair", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const ssh = debEntry("openssh-client", "9.6p1", ["ssh", "ssh-keygen"], "OpenSSH_9.6", { platform, packages: pick(sshArm64, sshX64) }, ["-V"])
  expect(await installEntry(cfg, ssh)).toBe("installed")
  const key = path.join(tmp.path, "id_ed25519")
  expect((await execute(cfg, "openssh-client", "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key])).code).toBe(0)
  expect(await Bun.file(`${key}.pub`).text()).toMatch(/^ssh-ed25519 /)
  await remove(cfg, "openssh-client", "9.6p1")
}, TIMEOUT_MS)

test.skipIf(!live)("make is installed and runs a rule from a Makefile", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const make = debEntry("make", "4.3", ["make"], "GNU Make 4.3", { platform, packages: pick(makeArm64, makeX64) })
  expect(await installEntry(cfg, make)).toBe("installed")
  await Bun.write(path.join(tmp.path, "Makefile"), "hello:\n\t@echo built-by-make\n")
  expect((await execute(cfg, "make", "make", ["-s", "hello"], { cwd: tmp.path })).stdout.trim()).toBe("built-by-make")
  await remove(cfg, "make", "4.3")
}, TIMEOUT_MS)

test.skipIf(!live)("cmake is installed and runs its command mode", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const cmake = debEntry("cmake", "3.28.3", ["cmake"], "cmake version 3.28.3", { platform, packages: pick(cmakeArm64, cmakeX64) })
  expect(await installEntry(cfg, cmake)).toBe("installed")
  expect((await execute(cfg, "cmake", "cmake", ["-E", "echo", "unifia"])).stdout.trim()).toBe("unifia")
  await remove(cfg, "cmake", "3.28.3")
}, TIMEOUT_MS)

test.skipIf(!live)("OpenJDK 17 is installed from its signed packages, compiles a Java program and runs it", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const jvm = platform === "linux-arm64" ? "java-17-openjdk-arm64" : "java-17-openjdk-amd64"
  const jdk = debEntry("openjdk-17", "17", ["javac", "java"], "javac 17", { platform, packages: pick(javaArm64, javaX64) }, ["-version"], `usr/lib/jvm/${jvm}/bin`)
  expect(await installEntry(cfg, jdk)).toBe("installed")
  const source = path.join(tmp.path, "Hello.java")
  await Bun.write(source, 'public class Hello { public static void main(String[] a) { System.out.println("hello from java " + Runtime.version().feature()); } }\n')
  // A JVM under emulation takes minutes, far beyond the default probe timeout.
  const slow = { timeout: 600_000 }
  expect((await execute(cfg, "openjdk-17", "javac", ["-d", tmp.path, source], slow)).code).toBe(0)
  const run = await execute(cfg, "openjdk-17", "java", ["-cp", tmp.path, "Hello"], slow)
  expect(run.stdout.trim()).toBe("hello from java 17")
  await remove(cfg, "openjdk-17", "17")
}, TIMEOUT_MS)

test.skipIf(!live)("Ruby 3.2 is installed from its signed packages and evaluates code, including its standard library", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  // Ruby's stdlib and its C extensions were compiled for /usr; RUBYLIB names the same directories in the install.
  const stdlib = ["usr/lib/ruby/3.2.0", "usr/lib/x86_64-linux-gnu/ruby/3.2.0", "usr/lib/aarch64-linux-gnu/ruby/3.2.0"]
  const ruby = debEntry("ruby", "3.2", ["ruby3.2"], "ruby 3.2", { platform, packages: pick(rubyArm64, rubyX64) }, ["--version"], "usr/bin", { RUBYLIB: stdlib })
  expect(await installEntry(cfg, ruby)).toBe("installed")
  expect((await execute(cfg, "ruby", "ruby3.2", ["-e", "puts 6*7"], { timeout: 600_000 })).stdout.trim()).toBe("42")
  const lib = await execute(cfg, "ruby", "ruby3.2", ["-rjson", "-e", "puts JSON.generate([1, 2])"], { timeout: 600_000 })
  expect(lib.stdout.trim()).toBe("[1,2]")
  await remove(cfg, "ruby", "3.2")
}, TIMEOUT_MS)

test.skipIf(!live)("PHP 8.3 is installed from its signed packages and runs a script", async () => {
  await using tmp = await tmpdir()
  const cfg = await config(tmp.path)
  const php = debEntry("php", "8.3", ["php8.3"], "PHP 8.3", { platform, packages: pick(phpArm64, phpX64) }, ["--version"])
  expect(await installEntry(cfg, php)).toBe("installed")
  expect((await execute(cfg, "php", "php8.3", ["-r", "echo 6*7, PHP_EOL;"], { timeout: 600_000 })).stdout.trim()).toBe("42")
  expect((await execute(cfg, "php", "php8.3", ["-r", "echo json_encode([1, 2]);"], { timeout: 600_000 })).stdout.trim()).toBe("[1,2]")
  await remove(cfg, "php", "8.3")
}, TIMEOUT_MS)
