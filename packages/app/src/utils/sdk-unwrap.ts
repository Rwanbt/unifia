// Shared by every observability settings sub-panel (Overview/Traces/
// Comparisons/Events/Privacy/Timeline/Cost) — the generated SDK returns
// `{ data?, error? }` rather than throwing, so each call site would
// otherwise repeat this same unwrap.
//
// This runs outside any component's setup, so it cannot call useLanguage()
// -- that context is only readable during a component's reactive scope.
// Reading document.documentElement.lang instead works because
// context/language.tsx keeps it in sync with the resolved locale via its own
// createEffect, and this only ever runs after the app has mounted (in
// response to an actual request). 26 call sites across 6 files all fall
// back to this one string; localizing it here once, instead of threading a
// translated message through every call site, is why this stays a
// same-locale-key lookup rather than an i18n key passed in by each caller.
const FALLBACK_MESSAGE: Record<string, string> = {
  en: "Request failed",
  fr: "La demande a échoué",
}

function fallbackMessage(): string {
  const lang = typeof document === "object" ? document.documentElement.lang : "en"
  return FALLBACK_MESSAGE[lang] ?? FALLBACK_MESSAGE.en
}

export async function unwrap<T>(request: Promise<{ data?: T; error?: unknown }>) {
  const result = await request
  if (result.data !== undefined) return result.data
  throw new Error(result.error instanceof Error ? result.error.message : fallbackMessage())
}
