import assert from "node:assert/strict";
import test from "node:test";
import { TEMPORARY_SHIMS, temporaryShimCounts } from "../src/domain/temporaryShims";

test("temporary shim descriptors classify mutating setup separately", () => {
  const counts = temporaryShimCounts();

  assert.equal(counts.total, TEMPORARY_SHIMS.length);
  assert.ok(counts.total >= 7);
  assert.ok(counts.explicitSetup >= 2);
  assert.ok(counts.mutating >= 2);

  const mutating = TEMPORARY_SHIMS.filter((shim) => shim.mutatesPiEnvironment);
  assert.ok(mutating.every((shim) => shim.releaseStance === "explicit-setup" || shim.releaseStance === "private-or-deferred"));
  assert.ok(mutating.every((shim) => shim.risks.includes("pi-environment-mutation")));
});

test("network/process/credential/filesystem shims are not default-on", () => {
  const sensitive = TEMPORARY_SHIMS.filter((shim) => shim.risks.some((risk) => risk === "network" || risk === "process" || risk === "credential" || risk === "filesystem"));

  assert.ok(sensitive.length > 0);
  assert.ok(sensitive.every((shim) => shim.releaseStance !== "default-on"));
});
