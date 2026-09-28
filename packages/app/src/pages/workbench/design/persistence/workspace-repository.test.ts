/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { doc, rect } from "../model/fixtures"
import { createLocalStorageDesignDocumentRepository, designDocumentStoragePrefix, type DesignDocumentStorage } from "./local-storage-repository"
import { createSdkDesignFileStore, type SdkFileClient } from "./sdk-file-store"
import {
  DesignDocumentBlockedError,
  createWorkspaceDesignDocumentRepository,
  designDocumentPath,
  type DesignFileStore,
} from "./workspace-repository"

function memoryStorage(): DesignDocumentStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  }
}

/** A workspace with hash compare-and-swap, like the server's file API. */
function fakeWorkspace(): DesignFileStore & { files: Map<string, string>; failNext: boolean } {
  const files = new Map<string, string>()
  const hashOf = (content: string) => `h${content.length}:${content.slice(-8)}`
  const workspace = {
    files,
    failNext: false,
    async read(path: string) {
      const content = files.get(path)
      return content === undefined ? undefined : { content, hash: hashOf(content) }
    },
    async write(path: string, content: string, expectedHash: string | undefined) {
      if (workspace.failNext) {
        workspace.failNext = false
        throw new Error("offline")
      }
      const current = files.get(path)
      if ((current === undefined) !== (expectedHash === undefined) || (current !== undefined && hashOf(current) !== expectedHash)) {
        throw new Error("conflict")
      }
      files.set(path, content)
      return { hash: hashOf(content) }
    },
    async remove(path: string) {
      files.delete(path)
    },
  }
  return workspace
}

const newRepository = (workspace: DesignFileStore, storage = memoryStorage()) =>
  createWorkspaceDesignDocumentRepository(workspace, createLocalStorageDesignDocumentRepository(storage))

describe("workspace design document repository", () => {
  test("Save_ThenLoad_RoundTripsThroughTheWorkspaceFile", async () => {
    const workspace = fakeWorkspace()
    const document = doc([rect("a")])
    await newRepository(workspace).save(document)
    expect(workspace.files.has(designDocumentPath("doc"))).toBe(true)
    expect(await newRepository(workspace).load("doc")).toEqual(document)
  })

  test("SecondSave_OverwritesWithTheKnownHash", async () => {
    const workspace = fakeWorkspace()
    const repository = newRepository(workspace)
    await repository.save(doc([rect("a")]))
    await repository.save(doc([rect("a"), rect("b")]))
    expect(JSON.parse(workspace.files.get(designDocumentPath("doc"))!).rootIds).toEqual(["a", "b"])
  })

  test("MissingFile_MigratesTheLocalStorageCopyIntoTheWorkspaceAndKeepsIt", async () => {
    const storage = memoryStorage()
    const legacy = doc([rect("old")])
    await createLocalStorageDesignDocumentRepository(storage).save(legacy)
    const workspace = fakeWorkspace()
    expect(await newRepository(workspace, storage).load("doc")).toEqual(legacy)
    expect(workspace.files.has(designDocumentPath("doc"))).toBe(true)
    expect(storage.entries.has(`${designDocumentStoragePrefix}doc`)).toBe(true)
  })

  test("MigrationThatFails_StillReturnsTheLocalDocument", async () => {
    const storage = memoryStorage()
    const legacy = doc([rect("old")])
    await createLocalStorageDesignDocumentRepository(storage).save(legacy)
    const workspace = fakeWorkspace()
    workspace.failNext = true
    expect(await newRepository(workspace, storage).load("doc")).toEqual(legacy)
  })

  test("NothingAnywhere_ResolvesToUndefined", async () => {
    expect(await newRepository(fakeWorkspace()).load("doc")).toBeUndefined()
  })

  test("FailedWorkspaceWrite_RejectsButKeepsALocalSafetyCopy", async () => {
    const storage = memoryStorage()
    const workspace = fakeWorkspace()
    workspace.failNext = true
    await expect(newRepository(workspace, storage).save(doc([rect("a")]))).rejects.toThrow("offline")
    expect(storage.entries.has(`${designDocumentStoragePrefix}doc`)).toBe(true)
  })

  test("UnreachableWorkspaceOnLoad_FallsBackToTheLocalCopy", async () => {
    const storage = memoryStorage()
    const document = doc([rect("a")])
    await createLocalStorageDesignDocumentRepository(storage).save(document)
    const offline: DesignFileStore = {
      read: () => Promise.reject(new Error("down")),
      write: async () => ({ hash: "" }),
      remove: async () => undefined,
    }
    expect(await newRepository(offline, storage).load("doc")).toEqual(document)
  })

  test("FileFromANewerSchema_IsNeverOverwritten", async () => {
    const workspace = fakeWorkspace()
    const future = JSON.stringify({ schemaVersion: 999, id: "doc", name: "x", rootIds: [], nodes: {} })
    workspace.files.set(designDocumentPath("doc"), future)
    const repository = newRepository(workspace)
    expect(await repository.load("doc")).toBeUndefined()
    await expect(repository.save(doc([rect("a")]))).rejects.toBeInstanceOf(DesignDocumentBlockedError)
    expect(workspace.files.get(designDocumentPath("doc"))).toBe(future)
  })

  test("OverlappingSaves_AreSerialisedNotRefusedAsConflicts", async () => {
    const workspace = fakeWorkspace()
    const repository = newRepository(workspace)
    await Promise.all([repository.save(doc([rect("a")])), repository.save(doc([rect("a"), rect("b")])), repository.save(doc([rect("c")]))])
    expect(JSON.parse(workspace.files.get(designDocumentPath("doc"))!).rootIds).toEqual(["c"])
  })

  test("Path_KeepsUnsafeIdsInsideTheDesignFolder", () => {
    expect(designDocumentPath("../evil/x")).toBe(".unifia/design/.._evil_x.design.json")
  })
})

describe("sdk design file store", () => {
  const stamped = (content: string) => ({ data: { content, stamp: { hash: "h" } } })
  const client = (parts: Partial<Record<keyof SdkFileClient, unknown>>) => parts as unknown as SdkFileClient

  test("Read_404IsAnAbsentFileNotAnError", async () => {
    const store = createSdkDesignFileStore(client({ readRaw: async () => ({ response: { status: 404 } }) }))
    expect(await store.read("x")).toBeUndefined()
  })

  test("Read_OtherFailuresReject", async () => {
    const store = createSdkDesignFileStore(client({ readRaw: async () => ({ response: { status: 500 } }) }))
    await expect(store.read("x")).rejects.toThrow()
  })

  test("Write_PassesTheExpectedHashOnlyWhenOverwriting", async () => {
    const calls: unknown[] = []
    const store = createSdkDesignFileStore(client({ write: async (input: unknown) => (calls.push(input), stamped("c")) }))
    await store.write("p", "c", undefined)
    await store.write("p", "c", "h0")
    expect(calls).toEqual([{ path: "p", content: "c" }, { path: "p", content: "c", expectedHash: "h0" }])
  })

  test("Write_409ExplainsTheConflict", async () => {
    const store = createSdkDesignFileStore(client({ write: async () => ({ response: { status: 409 } }) }))
    await expect(store.write("p", "c", "h")).rejects.toThrow("changed on disk")
  })
})
