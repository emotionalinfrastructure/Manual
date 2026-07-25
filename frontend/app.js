const form = document.getElementById("turn-form");
const input = document.getElementById("user-message");
const log = document.getElementById("log");
const apiBaseInput = document.getElementById("api-base");
const sessionIdInput = document.getElementById("session-id");
const sessionPanel = document.getElementById("session-panel");

const ACTION_LABEL = {
  allow: "allow",
  soften: "soften response",
  escalate: "escalate",
};

function appendMessage(role, content) {
  const el = document.createElement("div");
  el.className = `msg msg-${role}`;
  el.textContent = content;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function appendReply(result) {
  const el = document.createElement("div");
  el.className = "msg msg-assistant";
  el.textContent = result.assistant_reply;

  if (result.llm_backend === "simulated") {
    const note = document.createElement("div");
    note.className = "backend-note";
    note.textContent = "simulated reply — set ANTHROPIC_API_KEY on the worker for a real model";
    el.appendChild(note);
  }

  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

// Who the crisis language referred to. Two messages can both escalate for
// very different reasons, and the panel has to say which.
const CONTEXT_LABEL = {
  first_person: "first-person disclosure",
  third_party: "concern for someone else",
  topic_mention: "subject discussed, no one at risk",
};

function row(label, value) {
  const el = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = `${label} `;
  el.appendChild(strong);
  // textContent, not innerHTML: directive text is server-authored today, but
  // building it as a node means a future field carrying user text can't
  // become an injection point.
  el.appendChild(document.createTextNode(value));
  return el;
}

function appendAnalysis(result) {
  const { safety, emotional_state: emotion } = result;
  const el = document.createElement("div");
  // Severity is part of the class so escalate/high and escalate/medium are
  // visually distinct rather than an identical red block.
  el.className = `msg msg-analysis action-${safety.action} severity-${safety.severity}`;

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = ACTION_LABEL[safety.action] || safety.action;
  el.appendChild(badge);

  const sev = document.createElement("span");
  sev.className = "badge badge-severity";
  sev.textContent = `severity: ${safety.severity}`;
  el.appendChild(sev);

  const details = document.createElement("div");
  details.className = "analysis-details";
  details.appendChild(
    row(
      "Emotion:",
      `${emotion.primary_emotion} (sentiment ${emotion.sentiment_score}, intensity ${emotion.intensity})`
    )
  );
  details.appendChild(row("Flags:", safety.flags.length ? safety.flags.join(", ") : "none"));
  if (safety.crisis_context) {
    details.appendChild(
      row("Crisis context:", CONTEXT_LABEL[safety.crisis_context] || safety.crisis_context)
    );
  }
  if (result.suggested_system_directive) {
    details.appendChild(row("Injected directive:", result.suggested_system_directive));
  }

  el.appendChild(details);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function updateSessionPanel(result) {
  sessionPanel.classList.remove("hidden");
  document.getElementById("s-turns").textContent = result.turn;
  document.getElementById("s-trend").textContent = result.session_trend;
  document.getElementById("s-crisis").textContent = result.crisis_turn_count;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  const apiBase = apiBaseInput.value.trim().replace(/\/$/, "");
  const sessionId = sessionIdInput.value.trim() || "demo-123";

  appendMessage("user", message);
  input.value = "";
  input.disabled = true;

  try {
    const res = await fetch(`${apiBase}/v1/turn`, {
      // apiBase "" -> relative "/v1/turn", i.e. same origin as this page.
      // That's the default because the Worker is deployed with [assets]
      // serving this frontend from the same origin as the API.
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, user_message: message }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      appendMessage("error", `Request failed (${res.status}): ${errBody.error || res.statusText}`);
      return;
    }

    const result = await res.json();
    appendAnalysis(result);
    appendReply(result);
    updateSessionPanel(result);
  } catch (err) {
    appendMessage(
      "error",
      `Could not reach the middleware at ${apiBase || "(same origin)"}. Is it running? (npm run dev in middleware-worker/)`
    );
  } finally {
    input.disabled = false;
    input.focus();
  }
});
