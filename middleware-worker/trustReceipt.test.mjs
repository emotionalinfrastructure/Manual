import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateConformance, HARD_GATES_C2_C3, REQUIREMENT_IDS } from "./trustReceipt.js";

// Normative decision test vectors, Worksheet 5.4D. Naming mirrors the
// workbook's T01-T09 ids so a reviewer can check this file line-by-line
// against the source document.

test("T01: C2, R1-R12 all pass -> conforms, approved boundary", () => {
  const r = evaluateConformance({ consequenceClass: "C2", requirements: {} });
  assert.equal(r.overall, "conforms");
  assert.equal(r.mode, "approved_boundary");
});

test("T02: C1, R5=partial -> conditional, restricted", () => {
  const r = evaluateConformance({ consequenceClass: "C1", requirements: { R5: "partial" } });
  assert.equal(r.overall, "conditional");
  assert.equal(r.mode, "restricted_agentic");
});

test("T03: C1, R4=fail -> does not conform, disabled/manual", () => {
  const r = evaluateConformance({ consequenceClass: "C1", requirements: { R4: "fail" } });
  assert.equal(r.overall, "does_not_conform");
  assert.equal(r.mode, "disabled_or_manual_control");
});

test("T04: C2, R4=partial (hard gate) -> conditional, manual control", () => {
  const r = evaluateConformance({ consequenceClass: "C2", requirements: { R4: "partial" } });
  assert.equal(r.overall, "conditional");
  assert.equal(r.mode, "manual_control");
});

test("T05: C3, R5=partial (core, not hard gate) -> conditional, manual control", () => {
  const r = evaluateConformance({ consequenceClass: "C3", requirements: { R5: "partial" } });
  assert.equal(r.overall, "conditional");
  assert.equal(r.mode, "manual_control");
});

test("T06: C3, R12=fail -> does not conform, disabled/manual", () => {
  const r = evaluateConformance({ consequenceClass: "C3", requirements: { R12: "fail" } });
  assert.equal(r.overall, "does_not_conform");
  assert.equal(r.mode, "disabled_or_manual_control");
});

test("T07: C2, R5 evidence unavailable (claimed pass) -> does not conform", () => {
  const r = evaluateConformance({
    consequenceClass: "C2",
    requirements: { R5: "pass" },
    evidenceUnavailable: ["R5"],
  });
  assert.equal(r.requirements.R5.effective, "fail");
  assert.equal(r.overall, "does_not_conform");
  assert.equal(r.mode, "disabled_or_manual_control");
});

test("T08: C2, R11=fail -> does not conform, disabled/manual", () => {
  const r = evaluateConformance({ consequenceClass: "C2", requirements: { R11: "fail" } });
  assert.equal(r.overall, "does_not_conform");
  assert.equal(r.mode, "disabled_or_manual_control");
});

test("T09: C0, receipt not required, rationale approved -> not triggered, outside profile", () => {
  const r = evaluateConformance({ consequenceClass: "C0", receiptRequired: false, rationaleApproved: true });
  assert.equal(r.overall, "not_triggered");
  assert.equal(r.mode, "outside_profile");
});

// Invariants beyond the nine normative vectors.

test("noncompensation: a Pass elsewhere never cancels a Fail", () => {
  const requirements = Object.fromEntries(REQUIREMENT_IDS.map((id) => [id, "pass"]));
  requirements.R4 = "fail";
  const r = evaluateConformance({ consequenceClass: "C2", requirements });
  assert.equal(r.overall, "does_not_conform");
});

test("hard gates are exactly R1, R2, R4, R8, R10, R11, R12", () => {
  assert.deepEqual(HARD_GATES_C2_C3, ["R1", "R2", "R4", "R8", "R10", "R11", "R12"]);
});

test("C2 partial on a CORE (non-hard-gate) requirement does not force manual control", () => {
  const r = evaluateConformance({ consequenceClass: "C2", requirements: { R5: "partial" } });
  assert.equal(r.overall, "conditional");
  assert.equal(r.mode, "restricted_agentic");
});

test("rejects an unknown consequence class", () => {
  assert.throws(() => evaluateConformance({ consequenceClass: "C9", requirements: {} }));
});

test("rejects an unknown result value", () => {
  assert.throws(() => evaluateConformance({ consequenceClass: "C2", requirements: { R1: "maybe" } }));
});

test("C0 exclusion without an approved rationale is rejected", () => {
  assert.throws(() => evaluateConformance({ consequenceClass: "C0", receiptRequired: false }));
});
