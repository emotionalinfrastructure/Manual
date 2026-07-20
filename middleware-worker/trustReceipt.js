// AI Trust Receipt: Conformance Decision Protocol (Worksheet 5.4A-D /
// Technical Profile 5.4C from the AI Trust Receipt Workbook) implemented as a
// deterministic, noncompensatory decision engine.
//
// Two invariants drive the whole model:
//   - Noncompensation: a Pass on one requirement never cancels a Fail on another.
//   - Evidence precedence: unavailable required evidence overrides a claimed
//     Pass and always produces a Fail.

export const REQUIREMENT_IDS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12"];

export const HARD_GATES_C2_C3 = ["R1", "R2", "R4", "R8", "R10", "R11", "R12"];

export const REQUIREMENTS = {
  R1: {
    title: "Durable receipt by event state",
    gate: "HARD",
    assertions: [
      "A receipt is generated for every consequential action within scope.",
      "The receipt remains durable for the approved retention period.",
      "Every applicable attempted, executed, denied, delegated, escalated, reversed, and expired state is represented.",
    ],
  },
  R2: {
    title: "Actor and accountability identity",
    gate: "HARD",
    assertions: [
      "The acting agent or deployment is identified.",
      "The operating service is identified.",
      "The accountable organization is identified.",
    ],
  },
  R3: {
    title: "Action and state change",
    gate: "CORE",
    assertions: [
      "The action is described with a direct verb and specific object.",
      "The material before state is recorded when relevant.",
      "The material after state or non-success outcome is recorded.",
    ],
  },
  R4: {
    title: "Authority bound to action",
    gate: "HARD",
    assertions: [
      "The authority grant is identified and valid at event time.",
      "The authorized objective is recorded.",
      "The permitted scope and exclusions are bound to the action.",
      "The applicable confirmation requirement is satisfied.",
    ],
  },
  R5: {
    title: "Material inputs and provenance",
    gate: "CORE",
    assertions: [
      "Material input categories are identified.",
      "Material input provenance is recorded.",
      "Relevant freshness, quality, disputed, incomplete, or unavailable status is recorded.",
    ],
  },
  R6: {
    title: "Delegation and human oversight",
    gate: "CORE",
    assertions: [
      "Material delegation is recorded, including authority passed and evidence returned.",
      "The actual human-oversight function is recorded.",
      "The receipt does not imply review or control that did not occur.",
    ],
  },
  R7: {
    title: "Consequence and affected-party status",
    gate: "CORE",
    assertions: [
      "The consequence class is recorded and justified.",
      "Affected parties beyond the authorizing user are identified when applicable.",
      "Persistent external change is identified.",
    ],
  },
  R8: {
    title: "Remedy and accountable review",
    gate: "HARD",
    assertions: [
      "A correction pathway is available.",
      "A contest pathway is available.",
      "Reversal or restoration status is stated.",
      "An accountable review owner and time limit are identified.",
    ],
  },
  R9: {
    title: "Retention, access, and secondary use",
    gate: "CORE",
    assertions: [
      "Retention basis and period are defined and enforced.",
      "Access roles and access-event logging are defined and enforced.",
      "Prohibited secondary uses are defined and enforced.",
    ],
  },
  R10: {
    title: "Protected and excluded content",
    gate: "HARD",
    assertions: [
      "Private chain-of-thought is excluded.",
      "Secrets and credentials are excluded.",
      "Unrelated personal or third-party data is excluded or minimized.",
      "Misleading human-oversight claims are prohibited.",
    ],
  },
  R11: {
    title: "Cross-format consistency and verification",
    gate: "HARD",
    assertions: [
      "Human-readable and machine-readable forms describe the same event.",
      "The machine-readable form passes schema and semantic validation.",
      "The receipt can be verified outside the original interface.",
    ],
  },
  R12: {
    title: "Safe failure when evidence is unavailable",
    gate: "HARD",
    assertions: [
      "Required-evidence failure is detected.",
      "Execution pauses, fails safely, or produces a visible exception according to the approved policy.",
      "A consequential action does not execute silently when required accountability evidence is unavailable.",
    ],
  },
};

const CONSEQUENCE_CLASSES = ["C0", "C1", "C2", "C3"];
const RESULTS = ["pass", "partial", "fail"];

const MODE_LABELS = {
  approved_boundary: "Approved boundary",
  restricted_agentic: "Restricted (remediation required)",
  manual_control: "Manual control required",
  disabled_or_manual_control: "Disabled / manual control",
  outside_profile: "Outside profile (not triggered)",
};

const OVERALL_LABELS = {
  conforms: "Conforms",
  conditional: "Conditionally conforms",
  does_not_conform: "Does not conform",
  not_triggered: "Not triggered",
};

// input:
//   consequenceClass: "C0" | "C1" | "C2" | "C3"
//   requirements: { [R1..R12]: "pass" | "partial" | "fail" }  -- unlisted ids default to "pass"
//   evidenceUnavailable: string[]                             -- ids whose required evidence is unavailable
//   receiptRequired, rationaleApproved                        -- only meaningful for the C0 scope exclusion
export function evaluateConformance(input = {}) {
  const consequenceClass = input.consequenceClass;
  if (!CONSEQUENCE_CLASSES.includes(consequenceClass)) {
    throw new Error(`consequenceClass must be one of ${CONSEQUENCE_CLASSES.join(", ")}`);
  }

  // C0 scope exclusion: a receipt is not required at all, given an approved rationale.
  if (consequenceClass === "C0" && input.receiptRequired === false) {
    if (!input.rationaleApproved) {
      throw new Error("C0 exclusion requires an approved rationale (rationaleApproved: true).");
    }
    return {
      consequence_class: consequenceClass,
      overall: "not_triggered",
      overall_label: OVERALL_LABELS.not_triggered,
      mode: "outside_profile",
      mode_label: MODE_LABELS.outside_profile,
      requirements: {},
    };
  }

  const requirementInput = input.requirements || {};
  const evidenceUnavailable = new Set(input.evidenceUnavailable || []);

  const requirements = {};
  let anyFail = false;
  let anyPartial = false;
  let anyHardGatePartialAtC2 = false;

  for (const id of REQUIREMENT_IDS) {
    const claimed = requirementInput[id] || "pass";
    if (!RESULTS.includes(claimed)) {
      throw new Error(`${id}: result must be one of ${RESULTS.join(", ")}`);
    }
    // Evidence precedence: unavailable required evidence overrides a claimed Pass.
    const effective = evidenceUnavailable.has(id) ? "fail" : claimed;

    requirements[id] = {
      title: REQUIREMENTS[id].title,
      gate: REQUIREMENTS[id].gate,
      claimed,
      evidence_available: !evidenceUnavailable.has(id),
      effective,
    };

    if (effective === "fail") anyFail = true;
    if (effective === "partial") {
      anyPartial = true;
      if (consequenceClass === "C2" && HARD_GATES_C2_C3.includes(id)) anyHardGatePartialAtC2 = true;
    }
  }

  // Deterministic overall decision. Noncompensatory: a Pass never cancels a Fail.
  const overall = anyFail ? "does_not_conform" : anyPartial ? "conditional" : "conforms";

  // Deployment mode, applied in the priority order of the machine-readable profile.
  let mode;
  if (overall === "does_not_conform") {
    mode = "disabled_or_manual_control";
  } else if (consequenceClass === "C3" && anyPartial) {
    mode = "manual_control";
  } else if (anyHardGatePartialAtC2) {
    mode = "manual_control";
  } else if (overall === "conditional") {
    mode = "restricted_agentic";
  } else {
    mode = "approved_boundary";
  }

  return {
    consequence_class: consequenceClass,
    overall,
    overall_label: OVERALL_LABELS[overall],
    mode,
    mode_label: MODE_LABELS[mode],
    requirements,
  };
}
