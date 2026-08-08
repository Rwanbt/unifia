import type { ModelKey } from "@/context/local"

export const MAX_TEAM_MODELS = 8

export type TeamSelection = { models: ModelKey[] }

export function teamModelKey(model: ModelKey) {
  return `${model.providerID}:${model.modelID}`
}

// WHY: the server answers unknown API routes with the SPA fallback — HTTP 200 and
// `Content-Type: text/html` — so the generated SDK client parses the body as text and
// hands back an HTML string in `data` instead of an error. A sidecar older than the
// `/team/config` route therefore looks like a successful response. Treat everything
// crossing that boundary as `unknown` until it is proven to be a TeamSelection.
export function normalizeTeamSelection(value: unknown): TeamSelection | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const models = (value as { models?: unknown }).models
  if (!Array.isArray(models) || models.length > MAX_TEAM_MODELS) return undefined

  const normalized: ModelKey[] = []
  for (const entry of models) {
    if (typeof entry !== "object" || entry === null) return undefined
    const { providerID, modelID } = entry as { providerID?: unknown; modelID?: unknown }
    if (typeof providerID !== "string" || providerID.length === 0) return undefined
    if (typeof modelID !== "string" || modelID.length === 0) return undefined
    normalized.push({ providerID, modelID })
  }
  return { models: normalized }
}

export function validateTeamSelection(selection: TeamSelection | undefined, available: ReadonlySet<string>) {
  if (!selection || !Array.isArray(selection.models) || selection.models.length < 2 || selection.models.length > MAX_TEAM_MODELS) return false
  const keys = selection.models.map(teamModelKey)
  return new Set(keys).size === keys.length && keys.every((key) => available.has(key))
}
