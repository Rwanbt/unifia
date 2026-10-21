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
    // Node.js LTS. The sha256 values are the ones published in nodejs.org SHASUMS256.txt for this
    // release, and each size was measured from the same archive. The SHASUMS file itself is not
    // GPG-verified here; that check is listed as a remaining gap.
    id: "node",
    name: "Node.js",
    version: "24.22.1",
    license: "MIT",
    bins: ["node", "npm", "npx"],
    probe: { args: ["--version"], expect: "v24.22.1" },
    artifacts: [
      {
        platform: "linux-x64",
        url: "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz",
        archive: "tar.xz",
        prefix: "node-v24.22.1-linux-x64",
        size: 32026916,
        sha256: "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6",
      },
      {
        platform: "linux-arm64",
        url: "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-arm64.tar.xz",
        archive: "tar.xz",
        prefix: "node-v24.22.1-linux-arm64",
        size: 30978868,
        sha256: "dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e",
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
