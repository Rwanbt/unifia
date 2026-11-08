import { popularProviders } from "@/hooks/popular-providers"

/**
 * The on-device provider. The server only lists a provider that has models, so
 * before the first download `local-llm` is absent from the provider data: the
 * pickers must offer it on their own rather than derive it from the list.
 */
export const LOCAL_PROVIDER_ID = "local-llm"

export const FAVORITES_GROUP = "Favorites"

/** The model id the app registers for a downloaded `.gguf` file. */
export function localModelID(filename: string): string {
  return filename.replace(/\.gguf$/i, "").replace(/[-_]Q\d.*$/i, "")
}

function popularRank(providerID: string): number {
  const rank = popularProviders.indexOf(providerID)
  return rank < 0 ? Number.MAX_SAFE_INTEGER : rank
}

/** Provider order in the pickers: local AI first, then popular providers, then the rest. */
export function compareProviders(a: string, b: string): number {
  if (a === b) return 0
  if (a === LOCAL_PROVIDER_ID) return -1
  if (b === LOCAL_PROVIDER_ID) return 1
  return popularRank(a) - popularRank(b)
}

/** Group order in the model picker: favorites, then providers in `compareProviders` order. */
export function compareModelGroups(
  a: { category: string; providerID: string },
  b: { category: string; providerID: string },
): number {
  if (a.category === FAVORITES_GROUP) return -1
  if (b.category === FAVORITES_GROUP) return 1
  return compareProviders(a.providerID, b.providerID)
}

export function hasLocalModels(models: readonly { provider: { id: string } }[]): boolean {
  return models.some((m) => m.provider.id === LOCAL_PROVIDER_ID)
}
