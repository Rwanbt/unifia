/* SPDX-License-Identifier: MIT */

export type DesignSystemTokens = { colors: Readonly<Record<string, string>>; spacing: Readonly<Record<string, number>>; typography: Readonly<Record<string, string>> }
export type DesignSystemCatalog = { id: string; name: string; version: string; source: string; tokens: DesignSystemTokens }
export type DesignSystemPickerRow = { id: string; label: string; version: string; source: string; selected: boolean }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("design system field must be an object")
  return value as Record<string, unknown>
}

function stringMap(value: unknown, field: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => {
    if (typeof item !== "string" || !item) throw new Error(`${field}.${key} must be a non-empty string`)
    return [key, item]
  }))
}

function numberMap(value: unknown, field: string): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => {
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) throw new Error(`${field}.${key} must be a non-negative number`)
    return [key, item]
  }))
}

/** Parses an explicitly supplied catalog; it does not discover or create a source. */
export function parseDesignSystemCatalog(value: unknown): DesignSystemCatalog {
  const input = record(value)
  if (typeof input.id !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(input.id)) throw new Error("design system id is invalid")
  if (typeof input.name !== "string" || !input.name.trim()) throw new Error("design system name is required")
  if (typeof input.version !== "string" || !/^\d+\.\d+\.\d+$/.test(input.version)) throw new Error("design system version is invalid")
  if (typeof input.source !== "string" || !input.source.trim()) throw new Error("design system source is required")
  const tokens = record(input.tokens)
  return { id: input.id, name: input.name, version: input.version, source: input.source, tokens: { colors: stringMap(tokens.colors ?? {}, "colors"), spacing: numberMap(tokens.spacing ?? {}, "spacing"), typography: stringMap(tokens.typography ?? {}, "typography") } }
}

export function createDesignSystemPickerRows(catalogs: readonly DesignSystemCatalog[], selectedId?: string): readonly DesignSystemPickerRow[] {
  return [...catalogs].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version)).map((catalog) => ({ id: catalog.id, label: catalog.name, version: catalog.version, source: catalog.source, selected: catalog.id === selectedId }))
}

