/* SPDX-License-Identifier: MIT */

// The clangd release the LSP auto-download installs. The tag and the hashes move together:
// each hash is the GitHub asset digest, confirmed by downloading the archive.
export const CLANGD_RELEASE_TAG = "23.1.0"

export const CLANGD_ASSET_SHA256: Readonly<Record<string, string>> = {
  "clangd-linux-23.1.0.zip": "e53b1a96196095faedb7642cf64964f7fb9ad4a0c1f00dd2c172a3d9dcbafdfd",
  "clangd-mac-23.1.0.zip": "1082e6638223b785ca2daf0939f13afcd0bb95c84ee9a4bbaff4745365159253",
  "clangd-windows-23.1.0.zip": "23412a240756a162e7b98a282f36aa2a23a88db5ce16a0cbc4fef7253768c810",
}
