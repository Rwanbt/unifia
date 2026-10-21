// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { parse } from "./catalog"

// The pinned toolchains. Each size and digest was measured from the real artifact and checked
// against its source: Bun against the npm registry's sha512 SRI, Go against the sum.golang.org h1
// record. A pin is bumped by a reviewed change to this file, never by the device at runtime.
export const pinned = parse([
  {
    id: "bun",
    name: "Bun",
    version: "1.3.11",
    license: "MIT",
    bins: ["bun"],
    probe: { args: ["--version"], expect: "1.3.11" },
    artifacts: [
      {
        platform: "linux-x64",
        url: "https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.3.11.tgz",
        archive: "tar.gz",
        prefix: "package",
        size: 39103557,
        sha512: "sha512-z3GFCk1UBzDOOiEBHL32lVP7Edi26BhOjKb6bIc0nRyabbRiyON4++GR0zmd/H5zM5S0+UcXFgCGnD+b8avTLw==",
      },
      {
        platform: "linux-arm64",
        url: "https://registry.npmjs.org/@oven/bun-linux-aarch64/-/bun-linux-aarch64-1.3.11.tgz",
        archive: "tar.gz",
        prefix: "package",
        size: 39250588,
        sha512: "sha512-8XMLyRNxHF4jfLajkWt+F8UDxsWbzysyxQVMZKUXwoeGvaxB0rVd07r3YbgDtG8U6khhRFM3oaGp+CQ0whwmdA==",
      },
    ],
  },
  {
    id: "go",
    name: "Go",
    version: "1.27.3",
    license: "BSD-3-Clause",
    bins: ["go", "gofmt"],
    probe: { args: ["version"], expect: "go1.27.3" },
    artifacts: [
      {
        platform: "linux-x64",
        url: "https://proxy.golang.org/golang.org/toolchain/@v/v0.0.1-go1.27.3.linux-amd64.zip",
        archive: "zip",
        prefix: "golang.org/toolchain@v0.0.1-go1.27.3.linux-amd64",
        size: 75781305,
        h1: "h1:r0ub+FnqzZxoWm/dSUOI9DcIqYWn/mNYGFJcv7PyBzs=",
      },
      {
        platform: "linux-arm64",
        url: "https://proxy.golang.org/golang.org/toolchain/@v/v0.0.1-go1.27.3.linux-arm64.zip",
        archive: "zip",
        prefix: "golang.org/toolchain@v0.0.1-go1.27.3.linux-arm64",
        size: 72231413,
        h1: "h1:VY4gDzfxOrsM17J2qtgZgiAIsWhp7XWK1jMfE3kXV0s=",
      },
    ],
  },
])
