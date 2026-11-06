/* SPDX-License-Identifier: MIT */
// HTTP access to the rootless containers (ADR-098) for the settings UI. The CLI drives the same store and runtime.
// Running a command and removing an image or a container change what the phone executes or keeps, so they are
// `execute` in route-classes.ts.
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { type ContainerEngine, openContainerEngine } from "../../container/engine"
import { OciError, parseReference } from "../../container/oci"
import { Global } from "../../global"
import { errors } from "../error"

const REFUSED = "ContainerRefused"

// parseReference throws OciError on a reference it refuses; any other exception is not a validation answer.
function isReference(reference: string): boolean {
  try {
    parseReference(reference)
    return true
  } catch (error) {
    if (error instanceof OciError) return false
    throw error
  }
}

const Reference = z.string().min(1).refine(isReference, "not an OCI image reference")
const ReferenceBody = z.object({ reference: Reference })
const RunBody = z.object({ image: z.string().min(1), command: z.array(z.string()).default([]) })

const Image = z.object({ name: z.string(), digest: z.string() }).meta({ ref: "ContainerImage" })
const Container = z
  .object({
    id: z.string(),
    name: z.string(),
    image: z.string(),
    digest: z.string(),
    command: z.array(z.string()),
    created: z.string(),
    exitCode: z.number().optional(),
  })
  .meta({ ref: "ContainerRecord" })
const Pulled = z.object({ digest: z.string() }).meta({ ref: "ContainerPulled" })
const Ran = z.object({ container: Container, output: z.string() }).meta({ ref: "ContainerRunResult" })
const Removed = z.object({ removed: z.string() }).meta({ ref: "ContainerRemoved" })

// A reference or image the store refuses is the caller's mistake: 400 with the store's reason. Any other failure is a
// server fault and keeps the shared error handler.
async function refusable<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (!(error instanceof OciError)) throw error
    throw new HTTPException(400, { res: Response.json({ name: REFUSED, data: { message: error.message } }, { status: 400 }) })
  }
}

export function ContainerRoutes(engine: () => ContainerEngine = () => openContainerEngine(Global.Path.data)) {
  const described = (operationId: string, summary: string, schema: z.ZodType) =>
    describeRoute({
      summary,
      operationId,
      responses: {
        200: { description: summary, content: { "application/json": { schema: resolver(schema) } } },
        ...errors(400),
      },
    })

  return new Hono()
    .get("/images", described("container.images", "List the pulled images", z.array(Image)), (c) => c.json(engine().store.images()))
    .get("/", described("container.list", "List the containers", z.array(Container)), (c) => c.json(engine().runtime.list()))
    .post("/pull", described("container.pull", "Pull an image and verify it by digest", Pulled), validator("json", ReferenceBody), async (c) => {
      const { digest } = await refusable(() => engine().store.pull(c.req.valid("json").reference))
      return c.json({ digest })
    })
    .post("/run", described("container.run", "Run a command in a container and wait for it to exit", Ran), validator("json", RunBody), async (c) => {
      const { image, command } = c.req.valid("json")
      let output = ""
      const container = await refusable(() => engine().runtime.run(image, { command }, (chunk) => (output += chunk)))
      return c.json({ container, output })
    })
    // Registered before "/:id", which would otherwise match the path "image".
    .delete("/image", described("container.rmi", "Remove an image tag", Removed), validator("json", ReferenceBody), async (c) => {
      const { reference } = c.req.valid("json")
      await refusable(() => engine().store.remove(reference))
      return c.json({ removed: reference })
    })
    .delete("/:id", described("container.rm", "Remove a container by id or name", Removed), (c) => {
      const id = c.req.param("id")
      engine().runtime.remove(id)
      return c.json({ removed: id })
    })
}
