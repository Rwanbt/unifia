/**
 * The free models served by the hosted `opencode` gateway are not usable from
 * this app yet, so offering them only leads to failed requests. Hidden until
 * the gateway is wired up; paid `opencode` models stay listed.
 */
export function isUnavailableFreeModel(providerID: string, cost: { input: number } | undefined): boolean {
  return providerID === "opencode" && (!cost || cost.input === 0)
}
