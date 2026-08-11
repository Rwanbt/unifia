declare global {
  const UNIFIA_VERSION: string
  const UNIFIA_CHANNEL: string
}

export const VERSION = typeof UNIFIA_VERSION === "string" ? UNIFIA_VERSION : "local"
export const CHANNEL = typeof UNIFIA_CHANNEL === "string" ? UNIFIA_CHANNEL : "local"
