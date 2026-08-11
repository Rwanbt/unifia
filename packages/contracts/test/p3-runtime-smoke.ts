/* SPDX-License-Identifier: MIT */
import assert from "node:assert/strict"
import { AuditRuntimeDouble, KillSwitchDouble, QuotaDouble, SecretStoreDouble } from "../src/p3-runtime.ts"
let passed = 0
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`) }

test("C8-every-decision-logged", () => { const audit = new AuditRuntimeDouble(() => 1); const first = audit.record("operator", "workspace.write", "allow"); const second = audit.record("agent", "terminal.run", "deny"); assert.equal(audit.events().length, 2); assert.equal(second.previousHash, first.hash) })
test("C8-audit-chain-is-append-only", () => { const audit = new AuditRuntimeDouble(); audit.record("operator", "network.request", "approval_required"); const copy = audit.events(); copy.pop(); assert.equal(audit.events().length, 1) })
test("C9-secret-not-returned-to-agent-loop", () => { const store = new SecretStoreDouble(); store.put("API_TOKEN", "secret-value"); const handle = store.read("API_TOKEN", "sandbox-1"); assert.ok(handle); assert.notEqual(handle, "secret-value"); assert.equal(store.resolve(handle!, "sandbox-2"), undefined); assert.equal(store.resolve(handle!, "sandbox-1"), "secret-value") })
test("C9-quota-exceeded-deny", () => { const quota = new QuotaDouble(10); assert.equal(quota.consume(7), true); assert.equal(quota.consume(4), false); assert.equal(quota.remaining(), 3) })
test("C9-kill-switch-all-remote", () => { const switches = new KillSwitchDouble(); switches.engage("all-remote"); assert.equal(switches.isEngaged("all-remote"), true); assert.equal(switches.isEngaged("all-plugin-enable"), false) })
test("C9-kill-switch-global", () => { const switches = new KillSwitchDouble(); switches.engage("global"); assert.equal(switches.isEngaged("all-remote"), true); assert.equal(switches.isEngaged("all-plugin-enable"), true) })
assert.equal(passed, 6)
console.log(`P3 C8/C9: ${passed}/6 passed`)
import { KillSwitchRegistry, SecretStore } from "../src/p3-runtime.ts"
test("C9-secret-store-issues-scoped-expiring-handles", () => { let now = 1_000; const store = new SecretStore(() => now, 10); store.put({ name: "TOKEN", value: "value" }); const handle = store.issue("TOKEN", "sandbox-a"); assert.ok(handle); assert.equal(store.resolve(handle!, "sandbox-b"), undefined); assert.equal(store.resolve(handle!, "sandbox-a"), "value"); now = 1_011; assert.equal(store.resolve(handle!, "sandbox-a"), undefined) })
test("C9-kill-switch-registry-is-reversible-and-global", () => { const switches = new KillSwitchRegistry(); switches.engage("browser"); assert.equal(switches.isEngaged("browser"), true); assert.equal(switches.isEngaged("computer-use"), false); switches.engage("global"); assert.equal(switches.isEngaged("computer-use"), true); switches.release("global"); assert.equal(switches.isEngaged("computer-use"), false) })
