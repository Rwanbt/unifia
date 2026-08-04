/* SPDX-License-Identifier: MIT */
/**
 * WorkspacePort — abstraction sur le storage des workspaces
 *
 * ADR-0002
 * Source : Plan V3 §7.2
 */
export type WorkspaceId = string
export type ProjectId = string
export type SessionId = string
export type FileSessionId = string

export interface Workspace {
  id: WorkspaceId
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

export interface WorkspaceHandle {
  id: WorkspaceId
  token: string
}

export interface FileReadResult {
  path: string
  content: string | Uint8Array
  mime: string
  size: number
}

export interface FileWrite {
  path: string
  content: string | Uint8Array
  metadata?: Record<string, string>
}

export interface FileWriteResult {
  path: string
  bytesWritten: number
  sha: string
}

export interface FileEvent {
  sequence?: number
  type: "created" | "modified" | "deleted" | "renamed"
  path: string
  timestamp: number
}

export interface WorkspacePort {
  register(input: { name: string; path: string }): Promise<Workspace>
  open(id: WorkspaceId): Promise<WorkspaceHandle>
  read(session: FileSessionId, paths: string[]): Promise<FileReadResult[]>
  write(session: FileSessionId, writes: FileWrite[]): Promise<FileWriteResult[]>
  watch(session: FileSessionId): AsyncIterable<FileEvent>
  close(session: FileSessionId): Promise<void>
}
