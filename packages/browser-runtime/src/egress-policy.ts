/* SPDX-License-Identifier: MIT */
import { BrowserEgressPolicySchema, type BrowserController, type BrowserEgressPolicy } from "@unifia/contracts/browser"

export function browserEgressPolicyForController(
  policyInput: BrowserEgressPolicy,
  controller: BrowserController | undefined,
  authorizedOrigins: readonly string[],
): BrowserEgressPolicy {
  // See ADR-087: AI egress is scoped to origins granted within this Browser session.
  const policy = BrowserEgressPolicySchema.parse(policyInput)
  const sessionOrigins = new Set(authorizedOrigins)
  const allowedOrigins = controller === "user"
    ? [...policy.allowedOrigins]
    : controller === "ai"
      ? policy.allowedOrigins.includes("*")
        ? [...sessionOrigins]
        : policy.allowedOrigins.filter((origin) => sessionOrigins.has(origin))
      : []
  return BrowserEgressPolicySchema.parse({ ...policy, allowedOrigins })
}
