/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { serverRequestHeaders } from "./server"

const server = { url: "http://127.0.0.1:14096", username: "unifia", password: "secret" }

describe("serverRequestHeaders", () => {
  test("sends the connection's Basic credentials, as the SDK does", () => {
    const headers = serverRequestHeaders(server, undefined)
    expect(headers.get("authorization")).toBe(`Basic ${btoa("unifia:secret")}`)
  })

  test("a Bearer session wins over Basic credentials", () => {
    expect(serverRequestHeaders(server, "Bearer jwt", undefined).get("authorization")).toBe("Bearer jwt")
  })

  test("keeps the caller's headers and its own authorization", () => {
    const headers = serverRequestHeaders(server, "Bearer jwt", { "content-type": "application/json", authorization: "Bearer mine" })
    expect(headers.get("content-type")).toBe("application/json")
    expect(headers.get("authorization")).toBe("Bearer mine")
  })

  test("sends nothing when the server needs no credentials", () => {
    expect(serverRequestHeaders({ url: server.url }, undefined).has("authorization")).toBe(false)
  })
})
