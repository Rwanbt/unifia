import { createSignal, Show } from "solid-js"
import { TextField } from "@unifia/ui/text-field"
import { Button } from "@unifia/ui/button"
import { useLanguage } from "@/context/language"

export interface LoginFormProps {
  onLogin: (tokens: {
    accessToken: string
    refreshToken: string
    user: { id: string; username: string; role: "admin" | "member" | "viewer" }
  }) => void
  serverUrl: string
  fetch?: typeof fetch
  initialMode?: "login" | "register"
}

/**
 * Login/register form for collaborative mode.
 * Talks to the /collab/login and /collab/register endpoints.
 */
export function LoginForm(props: LoginFormProps) {
  const language = useLanguage()
  const [mode, setMode] = createSignal<"login" | "register">(props.initialMode ?? "login")
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [email, setEmail] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  async function submit(e: Event) {
    e.preventDefault()
    if (!username().trim() || !password().trim()) return

    setLoading(true)
    setError("")

    try {
      const endpoint = mode() === "login" ? "/collab/login" : "/collab/register"
      const body: Record<string, string> = {
        username: username(),
        password: password(),
      }
      if (mode() === "register" && email()) body.email = email()

      const res = await (props.fetch ?? fetch)(`${props.serverUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`)
        return
      }

      props.onLogin(data)
    } catch (e: any) {
      setError(e.message || language.t("auth.connectionFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} class="flex flex-col gap-3 p-6 max-w-sm mx-auto">
      <h2 class="text-18-medium text-text-strong text-center">
        {mode() === "login" ? language.t("auth.signIn") : language.t("auth.createAccount")}
      </h2>

      <TextField
        label={language.t("auth.username")}
        type="text"
        data-action="auth-username"
        value={username()}
        onInput={(e) => setUsername(e.currentTarget.value)}
        autocomplete="username"
        required
      />

      <Show when={mode() === "register"}>
        <TextField
          label={language.t("auth.emailOptional")}
          type="email"
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
      </Show>

      <TextField
        label={language.t("auth.password")}
        type="password"
        data-action="auth-password"
        value={password()}
        onInput={(e) => setPassword(e.currentTarget.value)}
        autocomplete={mode() === "login" ? "current-password" : "new-password"}
        required
        minLength={8}
      />

      <Show when={error()}>
        <p data-action="auth-error" class="text-12-regular text-text-on-critical-base">
          {error()}
        </p>
      </Show>

      <Button type="submit" data-action="auth-submit" disabled={loading()} variant="primary">
        {loading() ? "..." : mode() === "login" ? language.t("auth.signIn") : "Register"}
      </Button>

      <Button type="button" variant="ghost" onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}>
        {mode() === "login" ? language.t("auth.needAccount") : language.t("auth.alreadyAccount")}
      </Button>
    </form>
  )
}
