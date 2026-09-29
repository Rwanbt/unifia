// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
// Throwaway: Basic auth for the dev backend on 4099 (password from $TEMP/unifia-dev-pw.txt).
import { readFileSync } from "node:fs"
const pw = readFileSync(process.env.TEMP + "/unifia-dev-pw.txt", "utf8").trim()
const auth = "Basic " + Buffer.from("unifia:" + pw).toString("base64")
export async function withAuth(page: any) {
  await page.route(/localhost:4099|127\.0\.0\.1:4099/, (route: any) => route.continue({ headers: { ...route.request().headers(), authorization: auth } }))
}
