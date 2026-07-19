// Rule-based emotional/safety lexicon. Deterministic and dependency-free so the
// demo runs anywhere a fetch()-shaped handler can run (Cloudflare Workers or plain Node).

export const EMOTION_LEXICON = {
  joy: ["happy", "excited", "great", "awesome", "glad", "love", "wonderful", "thrilled", "grateful", "proud"],
  sadness: ["sad", "down", "depressed", "lonely", "hopeless", "empty", "crying", "miserable", "grief", "heartbroken"],
  anger: ["angry", "furious", "pissed", "mad", "hate", "rage", "frustrated", "annoyed", "resentful"],
  fear: ["scared", "afraid", "anxious", "terrified", "worried", "nervous", "panic", "dread"],
  gratitude: ["thank", "thanks", "appreciate", "grateful", "blessed"],
};

const POSITIVE_WORDS = new Set([...EMOTION_LEXICON.joy, ...EMOTION_LEXICON.gratitude]);
const NEGATIVE_WORDS = new Set([
  ...EMOTION_LEXICON.sadness,
  ...EMOTION_LEXICON.anger,
  ...EMOTION_LEXICON.fear,
]);

// Intentionally narrow, literal phrases only — this is a demo-grade tripwire,
// not a clinical risk model. Real deployments should route to a reviewed
// crisis-detection service instead of a keyword list.
export const CRISIS_PHRASES = [
  "kill myself",
  "want to die",
  "end my life",
  "suicidal",
  "suicide",
  "hurt myself",
  "self harm",
  "self-harm",
  "no reason to live",
  "better off dead",
];

export const ABUSE_PHRASES = [
  "kill you",
  "i hate you",
  "you're worthless",
  "youre worthless",
  "shut up and die",
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\b(\+?\d[\d\s().-]{7,}\d)\b/g;

function tokenize(text) {
  return text.toLowerCase().match(/[a-z']+/g) || [];
}

function containsPhrase(lowerText, phrases) {
  return phrases.filter((phrase) => lowerText.includes(phrase));
}

/**
 * Analyze a single message for emotional tone, safety risk, and PII.
 * Pure function: same input always yields the same output, no I/O.
 */
export function analyzeMessage(text) {
  const lowerText = (text || "").toLowerCase();
  const tokens = tokenize(text || "");

  const emotionCounts = {};
  for (const [emotion, words] of Object.entries(EMOTION_LEXICON)) {
    emotionCounts[emotion] = tokens.filter((t) => words.includes(t)).length;
  }

  let positiveHits = 0;
  let negativeHits = 0;
  for (const t of tokens) {
    if (POSITIVE_WORDS.has(t)) positiveHits++;
    if (NEGATIVE_WORDS.has(t)) negativeHits++;
  }

  const totalHits = positiveHits + negativeHits;
  const sentimentScore = totalHits === 0 ? 0 : (positiveHits - negativeHits) / totalHits;

  let primaryEmotion = "neutral";
  let maxCount = 0;
  for (const [emotion, count] of Object.entries(emotionCounts)) {
    if (count > maxCount) {
      maxCount = count;
      primaryEmotion = emotion;
    }
  }

  const intensity = tokens.length === 0 ? 0 : Math.min(1, totalHits / Math.max(4, tokens.length * 0.5));

  const crisisMatches = containsPhrase(lowerText, CRISIS_PHRASES);
  const abuseMatches = containsPhrase(lowerText, ABUSE_PHRASES);
  const emails = text ? text.match(EMAIL_RE) || [] : [];
  const phones = text ? text.match(PHONE_RE) || [] : [];

  const flags = [];
  if (crisisMatches.length) flags.push("crisis_language");
  if (abuseMatches.length) flags.push("abusive_language");
  if (emails.length || phones.length) flags.push("pii_detected");

  return {
    sentiment_score: Number(sentimentScore.toFixed(2)),
    primary_emotion: primaryEmotion,
    intensity: Number(intensity.toFixed(2)),
    flags,
    matched_phrases: [...crisisMatches, ...abuseMatches],
    pii: {
      emails: emails.length,
      phones: phones.length,
    },
  };
}
