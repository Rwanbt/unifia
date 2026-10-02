import { Provider } from "../provider/provider"
import { NamedError } from "@unifia/util/error"
import { NotFoundError } from "../storage/db"
import { Session } from "../session"
import { Permission } from "../permission"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import type { Log } from "../util/log"

export function errorHandler(log: Log.Logger): ErrorHandler {
  return (err, c) => {
    log.error("failed", {
      error: err,
    })
    if (err instanceof NamedError) {
      let status: ContentfulStatusCode
      if (err instanceof NotFoundError) status = 404
      else if (err instanceof Provider.ModelNotFoundError) status = 400
      else if (err.name === "ProviderAuthValidationFailed") status = 400
      else if (err.name.startsWith("Worktree")) status = 400
      else status = 500
      return c.json(err.toObject(), { status })
    }
    if (err instanceof Session.BusyError) {
      return c.json(new NamedError.Unknown({ message: err.message }).toObject(), { status: 400 })
    }
    if (err instanceof HTTPException) return err.getResponse()
    // A permission refusal is an expected outcome, not a server fault: answer 403 with the same
    // { name, data } shape as NamedError and never leak a stack trace.
    if (
      err instanceof Permission.DeniedError ||
      err instanceof Permission.RejectedError ||
      err instanceof Permission.CorrectedError
    ) {
      return c.json({ name: err._tag, data: { message: err.message } }, { status: 403 })
    }
    const message = err instanceof Error && err.stack ? err.stack : err.toString()
    return c.json(new NamedError.Unknown({ message }).toObject(), {
      status: 500,
    })
  }
}
