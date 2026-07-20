const apiBaseInput = document.getElementById("api-base");
const apiKeyInput = document.getElementById("api-key");
const connStatus = document.getElementById("conn-status");

function apiBase() {
  return apiBaseInput.value.trim().replace(/\/$/, "");
}

async function apiFetch(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  const key = apiKeyInput.value.trim();
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${apiBase()}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

function setStatus(message, isError) {
  connStatus.textContent = message;
  connStatus.style.color = isError ? "#991b1b" : "#6b7280";
}

// ---------- Tabs ----------
const tabButtons = [...document.querySelectorAll(".tab-btn")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    tabPanels.forEach((p) => p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
    loadTab(btn.dataset.tab);
  });
});

function loadTab(tab) {
  if (tab === "sessions") return loadSessions();
  if (tab === "ai-use") return loadRecords("ai-use");
  if (tab === "disclosure-review") return loadRecords("disclosure-review");
  if (tab === "qa-findings") return loadRecords("qa-findings");
  if (tab === "release-checklist") return loadChecklist();
}

// ---------- Live Sessions ----------
const sessionsBody = document.querySelector("#sessions-table tbody");
const sessionsEmpty = document.getElementById("sessions-empty");
const autoRefreshCheckbox = document.getElementById("auto-refresh");
let refreshTimer = null;

function trendClass(trend) {
  return `trend-badge trend-${trend}`;
}

async function loadSessions() {
  try {
    const { sessions } = await apiFetch("/v1/sessions");
    setStatus(`Connected · ${sessions.length} session${sessions.length === 1 ? "" : "s"}`);
    sessionsBody.innerHTML = "";
    sessionsEmpty.classList.toggle("hidden", sessions.length > 0);
    for (const s of sessions) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(s.session_id)}</td>
        <td>${s.turn_count}</td>
        <td><span class="${trendClass(s.trend)}">${s.trend}</span></td>
        <td>${s.crisis_turn_count}</td>
        <td>${formatTime(s.created_at)}</td>
        <td>${formatTime(s.last_turn_at)}</td>
      `;
      sessionsBody.appendChild(tr);
    }
  } catch (err) {
    setStatus(`Could not reach ${apiBase()}: ${err.message}`, true);
  }
}

function formatTime(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.getElementById("refresh-sessions").addEventListener("click", loadSessions);
autoRefreshCheckbox.addEventListener("change", scheduleAutoRefresh);

function scheduleAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (autoRefreshCheckbox.checked) {
    refreshTimer = setInterval(() => {
      if (document.getElementById("tab-sessions").classList.contains("active")) loadSessions();
    }, 5000);
  }
}

// ---------- Governance record tables (AI Use / Disclosure Review / QA Findings) ----------
const RECORD_CONFIG = {
  "ai-use": {
    tableId: "table-ai-use",
    formId: "form-ai-use",
    columns: [
      "system_tool",
      "audience_facing",
      "trust_impact_level",
      "ai_function",
      "disclosure_needed",
      "human_review_required",
      "owner",
      "record_location",
    ],
  },
  "disclosure-review": {
    tableId: "table-disclosure-review",
    formId: "form-disclosure-review",
    columns: ["asset", "ai_involvement", "disclosure_level", "reviewer", "risk_note", "approved", "follow_up"],
  },
  "qa-findings": {
    tableId: "table-qa-findings",
    formId: "form-qa-findings",
    columns: ["area", "finding", "priority", "status", "owner", "due", "closure_note"],
    editableStatus: true,
  },
};

async function loadRecords(kind) {
  const config = RECORD_CONFIG[kind];
  const tbody = document.querySelector(`#${config.tableId} tbody`);
  try {
    const { items } = await apiFetch(`/v1/governance/${kind}`);
    setStatus(`Connected · ${items.length} record${items.length === 1 ? "" : "s"}`);
    tbody.innerHTML = "";
    for (const item of items) {
      tbody.appendChild(renderRecordRow(kind, config, item));
    }
  } catch (err) {
    setStatus(`Could not reach ${apiBase()}: ${err.message}`, true);
  }
}

function renderRecordRow(kind, config, item) {
  const tr = document.createElement("tr");

  for (const col of config.columns) {
    const td = document.createElement("td");
    if (kind === "qa-findings" && col === "status" && config.editableStatus) {
      const select = document.createElement("select");
      select.className = "status-select";
      for (const opt of ["Open", "Closed"]) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        o.selected = item.status === opt;
        select.appendChild(o);
      }
      select.addEventListener("change", async () => {
        try {
          await apiFetch(`/v1/governance/${kind}/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: select.value }),
          });
          loadRecords(kind);
        } catch (err) {
          setStatus(`Update failed: ${err.message}`, true);
        }
      });
      td.appendChild(select);
    } else {
      td.textContent = item[col] ?? "";
    }
    tr.appendChild(td);
  }

  const actionsTd = document.createElement("td");
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "row-btn danger";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    try {
      await apiFetch(`/v1/governance/${kind}/${item.id}`, { method: "DELETE" });
      loadRecords(kind);
    } catch (err) {
      setStatus(`Delete failed: ${err.message}`, true);
    }
  });
  actionsTd.appendChild(deleteBtn);
  tr.appendChild(actionsTd);

  return tr;
}

for (const [kind, config] of Object.entries(RECORD_CONFIG)) {
  const form = document.getElementById(config.formId);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await apiFetch(`/v1/governance/${kind}`, { method: "POST", body: JSON.stringify(data) });
      form.reset();
      loadRecords(kind);
    } catch (err) {
      setStatus(`Create failed: ${err.message}`, true);
    }
  });
}

// ---------- Release Readiness Checklist ----------
const checklistList = document.getElementById("checklist-list");

async function loadChecklist() {
  try {
    const { items } = await apiFetch("/v1/governance/release-checklist");
    const done = items.filter((i) => i.complete).length;
    setStatus(`Connected · ${done}/${items.length} release gates complete`);
    checklistList.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      li.className = item.complete ? "done" : "";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.complete;
      checkbox.addEventListener("change", async () => {
        try {
          await apiFetch(`/v1/governance/release-checklist/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({ complete: checkbox.checked }),
          });
          loadChecklist();
        } catch (err) {
          setStatus(`Update failed: ${err.message}`, true);
        }
      });
      const label = document.createElement("span");
      label.className = "checklist-label";
      label.textContent = item.item;
      li.appendChild(checkbox);
      li.appendChild(label);
      checklistList.appendChild(li);
    }
  } catch (err) {
    setStatus(`Could not reach ${apiBase()}: ${err.message}`, true);
  }
}

// ---------- Init ----------
scheduleAutoRefresh();
loadSessions();
