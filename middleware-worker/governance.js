// In-memory stores for the governance record-keeping instruments defined in
// the Emotional Infrastructure Professional Governance Manual: the AI Use
// Inventory and Disclosure Review Record (Product Front Matter, p.6-7), the
// QA Findings Tracker (Appendix F), and the Release Readiness Checklist
// (Appendix I). Same single-isolate, in-memory tradeoff as the session store
// in index.js -- a real deployment would back these with KV or a Durable
// Object so records survive across isolates/requests.

function makeCrudStore(fields) {
  const items = new Map();

  function list() {
    return [...items.values()];
  }

  function create(input) {
    const id = crypto.randomUUID();
    const record = { id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    for (const field of fields) record[field] = input?.[field] ?? null;
    items.set(id, record);
    return record;
  }

  function update(id, patch) {
    const record = items.get(id);
    if (!record) return null;
    for (const field of fields) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, field)) record[field] = patch[field];
    }
    record.updated_at = new Date().toISOString();
    return record;
  }

  function remove(id) {
    return items.delete(id);
  }

  return { list, create, update, remove };
}

export const aiUseInventory = makeCrudStore([
  "system_tool",
  "audience_facing",
  "trust_impact_level",
  "ai_function",
  "disclosure_needed",
  "human_review_required",
  "owner",
  "record_location",
]);

export const disclosureReview = makeCrudStore([
  "asset",
  "ai_involvement",
  "disclosure_level",
  "reviewer",
  "risk_note",
  "approved",
  "follow_up",
]);

export const qaFindings = makeCrudStore([
  "area",
  "finding",
  "priority",
  "status",
  "owner",
  "due",
  "closure_note",
]);

// Release Readiness Checklist (Appendix I.1) is a fixed set of gates, not an
// open-ended log -- seed it once and only allow toggling `complete`.
const RELEASE_CHECKLIST_ITEMS = [
  "Final appendix map approved",
  "Terminology consistent with the Appendix C glossary",
  "Risk-level terminology consistent (Low, Moderate, High, Critical)",
  "EI-STD references verified against Appendix B (Standards Index)",
  "QA Findings Tracker (Appendix F) closed",
  "Source-note cleanup complete",
  "Pagination locked",
  "Indexes verified against final PDF",
  "Final PDF exported from locked manuscript",
  "Archive copy saved",
];

const releaseChecklistItems = new Map();
for (const label of RELEASE_CHECKLIST_ITEMS) {
  const id = crypto.randomUUID();
  releaseChecklistItems.set(id, { id, item: label, complete: false, updated_at: null });
}

export const releaseChecklist = {
  list() {
    return [...releaseChecklistItems.values()];
  },
  update(id, patch) {
    const record = releaseChecklistItems.get(id);
    if (!record) return null;
    if (patch && typeof patch.complete === "boolean") record.complete = patch.complete;
    record.updated_at = new Date().toISOString();
    return record;
  },
};
