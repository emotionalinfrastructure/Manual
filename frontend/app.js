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

function appendAnalysis(result) {
  const el = document.createElement("div");
  el.className = `msg msg-analysis action-${result.safety.action}`;

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = ACTION_LABEL[result.safety.action] || result.safety.action;
  el.appendChild(badge);

  const details = document.createElement("div");
  details.className = "analysis-details";
  details.innerHTML = `
    <div><strong>Emotion:</strong> ${result.emotional_state.primary_emotion} (sentiment ${result.emotional_state.sentiment_score}, intensity ${result.emotional_state.intensity})</div>
    <div><strong>Flags:</strong> ${result.safety.flags.length ? result.safety.flags.join(", ") : "none"}</div>
    ${result.suggested_system_directive ? `<div><strong>Injected directive:</strong> ${result.suggested_system_directive}</div>` : ""}
  `;
  el.appendChild(details);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function updateSessionPanel(result) {
  sessionPanel.classList.remove("hidden");
  document.getElementById("s-turns").textContent = result.turn;
  document.getElementById("s-trend").textContent = result.session_trend;
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
    updateSessionPanel(result);
  } catch (err) {
    appendMessage(
      "error",
      `Could not reach the middleware at ${apiBase}. Is it running? (npm run dev in middleware-worker/)`
    );
  } finally {
    input.disabled = false;
    input.focus();
  }
});
