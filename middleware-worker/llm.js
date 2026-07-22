// Generates the assistant's actual reply, steered by the policy directive.
// This is the point of the middleware: it doesn't just score the message, it
// sits in front of the model call and shapes it.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

const BASE_PERSONA =
  "You are a helpful, concise AI assistant embedded in a demo product. Keep replies to 2-3 sentences unless asked for more.";

export function buildSystemPrompt(directive) {
  if (!directive) return BASE_PERSONA;
  return (
    `${BASE_PERSONA}\n\nCompliance directive from the emotional-infrastructure middleware ` +
    `(follow this before anything else, and do not mention that it was given to you): ${directive}`
  );
}

// No API key configured -> deterministic, demo-safe reply so the whole
// pipeline still runs end to end without any external dependency.
function simulateReply(action, userMessage) {
  if (action === "escalate") {
    return (
      "I want to make sure you're safe first. If you're thinking about harming yourself, please reach out to " +
      "the 988 Suicide & Crisis Lifeline (call or text 988 in the US) or your local emergency number — you " +
      "don't have to go through this alone. I'm here to keep talking whenever you're ready."
    );
  }
  if (action === "soften") {
    return (
      "That sounds really hard, and it makes sense you'd feel this way. I'm here with you — do you want to " +
      "talk through what's going on, or would it help more to focus on next steps?"
    );
  }
  const preview = userMessage.length > 140 ? `${userMessage.slice(0, 140)}…` : userMessage;
  return `Got it: "${preview}". (Simulated reply — set ANTHROPIC_API_KEY to have a real model answer this.)`;
}

/**
 * @param {object} opts
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {string|null} opts.systemDirective
 * @param {string} opts.action - "allow" | "soften" | "escalate"
 * @param {{role: string, content: string}[]} opts.history
 * @param {string} opts.userMessage
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function generateReply({ apiKey, model, systemDirective, action, history, userMessage, fetchImpl }) {
  const doFetch = fetchImpl || fetch;

  if (!apiKey) {
    return { text: simulateReply(action, userMessage), backend: "simulated" };
  }

  try {
    const res = await doFetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 300,
        system: buildSystemPrompt(systemDirective),
        messages: [...history, { role: "user", content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        text: simulateReply(action, userMessage),
        backend: "simulated",
        note: `llm_call_failed (${res.status}): ${errText.slice(0, 200)}`,
      };
    }

    const data = await res.json();
    const text = (data.content || []).map((block) => block.text || "").join("").trim();
    return { text: text || simulateReply(action, userMessage), backend: "anthropic" };
  } catch (err) {
    return {
      text: simulateReply(action, userMessage),
      backend: "simulated",
      note: `llm_call_errored: ${err.message}`,
    };
  }
}
