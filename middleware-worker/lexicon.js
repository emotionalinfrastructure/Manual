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
// Crisis vocabulary, split by what a match actually tells you.
//
// Detection stays broad — recall matters more than precision here, because
// missing a real disclosure is far worse than offering support to someone who
// did not need it. What the split enables is a *proportionate response*: the
// policy layer can tell "I want to kill myself" apart from "suicide rates
// declined last year" instead of treating both as imminent risk.

// Inherently self-referential. A match is a first-person disclosure.
export const FIRST_PERSON_CRISIS_PHRASES = [
  "kill myself",
  "want to die",
  "end my life",
  "hurt myself",
  "harm myself",
  "no reason to live",
  "better off dead",
];

// Someone describing another person — usually a user seeking help for a
// friend or family member. Previously undetected entirely (a false negative).
export const THIRD_PARTY_CRISIS_PHRASES = [
  "kill herself",
  "kill himself",
  "kill themselves",
  "end her life",
  "end his life",
  "end their life",
  "hurt herself",
  "hurt himself",
  "hurt themselves",
];

// Topic words. Alone they carry no information about who is at risk: they
// appear in disclosures, in third-party concern, and in news, research, and
// history alike. Context resolution below decides which.
export const CRISIS_TOPIC_KEYWORDS = ["suicidal", "suicide", "self harm", "self-harm"];

// Retained as the union for callers that just want "is any crisis vocabulary
// present", independent of who it refers to.
export const CRISIS_PHRASES = [
  ...FIRST_PERSON_CRISIS_PHRASES,
  ...THIRD_PARTY_CRISIS_PHRASES,
  ...CRISIS_TOPIC_KEYWORDS,
];

// Checked before first-person markers, because "my friend is suicidal"
// contains "my" but is not a self-disclosure.
const THIRD_PARTY_SUBJECT_RE =
  /\b(my (friend|brother|sister|son|daughter|child|kid|mom|mum|dad|mother|father|parent|partner|wife|husband|boyfriend|girlfriend|colleague|coworker|classmate|student|patient|neighbou?r|cousin|aunt|uncle)|he|him|his|she|her|they|them|their|someone|somebody|a friend)\b/;

const FIRST_PERSON_SUBJECT_RE = /\b(i|i'm|im|i've|ive|me|my|myself)\b/;

// Academic, professional, or journalistic framing around a topic word. Only
// consulted when a bare topic word matched — an explicit phrase like "kill
// myself" is never reclassified by framing, so "I'm writing a paper and I
// want to kill myself" still reads as a disclosure.
const TOPIC_FRAMING_RE =
  /\b(research(ing|er|ers)?|stud(y|ying|ies|ied)|paper|article|essay|thesis|dissertation|book|report|journalis(m|t)|reporting|statistics?|data|rates?|trends?|prevention (policy|programme?|campaign|training)|coursework|lecture|seminar|class|module|curriculum|documentary|survey|hotline (staff|volunteer)|clinician|counsell?or training)\b/;

export const ABUSE_PHRASES = [
  "kill you",
  "i hate you",
  "you're worthless",
  "youre worthless",
  "shut up and die",
];

// Quantifiers are bounded rather than open-ended, using the RFC 5321 length
// limits (64-octet local part, 255-octet domain) as the natural ceiling.
//
// An unbounded `+` in front of a required literal is quadratic on input that
// never satisfies the literal: a long run of local-part characters with no
// "@" makes the engine consume the run, fail, and rescan from the next start
// position, for every position. A 1 MB message of ordinary letters took
// roughly twenty minutes of fully blocked event loop. Bounding the run caps
// the work per start position, which keeps the scan linear in input length.
const EMAIL_RE = /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,24}/g;
const PHONE_RE = /\b(\+?\d[\d\s().-]{7,}\d)\b/g;

/**
 * Collapse the formatting noise that separates two words, so phrase matching
 * sees "kill myself" in "kill  myself", "kill-myself", and a phrase broken
 * across a line.
 *
 * These are not evasion attempts — they are how people actually type — and a
 * literal substring matcher missed all three while catching the identical
 * sentence typed plainly.
 *
 * Deliberately leaves "." alone: collapsing sentence boundaries would let
 * "...I had to kill. Myself, I would have waited" match "kill myself". The
 * separators handled here cannot join two sentences the way a period can.
 */
export function normalizeForMatch(lowerText) {
  return lowerText.replace(/[\s_-]+/g, " ").trim();
}

function tokenize(text) {
  return text.toLowerCase().match(/[a-z']+/g) || [];
}

function containsPhrase(lowerText, phrases) {
  return phrases.filter((phrase) => lowerText.includes(phrase));
}

/**
 * Decide who the crisis vocabulary in a message refers to.
 *
 * Returns null when no crisis vocabulary is present, otherwise one of:
 *   "first_person"  — the user disclosing about themselves
 *   "third_party"   — the user describing someone else
 *   "topic_mention" — the subject discussed without a person at risk
 *                     (news, statistics, research, history, fiction)
 *
 * Known limitation, deliberately left conservative: quoted speech
 * ('she texted me "I want to kill myself"') classifies as first_person,
 * because the quoted words match a self-referential phrase. Erring toward
 * offering support is the safe direction for a demo-grade rule engine;
 * distinguishing quotation reliably needs more than substring matching.
 */
export function classifyCrisisContext(lowerText, { firstPerson, thirdParty, topic }) {
  if (firstPerson.length) return "first_person";
  if (thirdParty.length) return "third_party";
  if (!topic.length) return null;
  // Only a topic word matched — resolve by who the sentence is about.
  if (THIRD_PARTY_SUBJECT_RE.test(lowerText)) return "third_party";
  if (FIRST_PERSON_SUBJECT_RE.test(lowerText)) {
    // "I am suicidal" is a disclosure; "I am researching suicide" is not.
    // Where the framing is explicitly academic or professional, treat it as
    // subject matter. Anything else first-person stays a disclosure: an
    // unnecessary offer of support is a far cheaper error than a missed one.
    return TOPIC_FRAMING_RE.test(lowerText) ? "topic_mention" : "first_person";
  }
  return "topic_mention";
}

/**
 * Analyze a single message for emotional tone, safety risk, and PII.
 * Pure function: same input always yields the same output, no I/O.
 */
export function analyzeMessage(text) {
  const lowerText = (text || "").toLowerCase();
  // Phrase and subject matching run against the normalised form; PII
  // detection below deliberately stays on the raw text, because the
  // separators normalisation collapses are exactly what phone numbers are
  // written with.
  const matchText = normalizeForMatch(lowerText);
  const tokens = tokenize(text || "");

  const emotionCounts = {};
  for (const [emotion, words] of Object.entries(EMOTION_LEXICON)) {
    emotionCounts[emotion] = tokens.filter((t) => words.includes(t)).length;
  }

  const firstPersonMatches = containsPhrase(matchText, FIRST_PERSON_CRISIS_PHRASES);
  const thirdPartyMatches = containsPhrase(matchText, THIRD_PARTY_CRISIS_PHRASES);
  const topicMatches = containsPhrase(matchText, CRISIS_TOPIC_KEYWORDS);
  const crisisMatches = [...firstPersonMatches, ...thirdPartyMatches, ...topicMatches];
  const crisisContext = classifyCrisisContext(matchText, {
    firstPerson: firstPersonMatches,
    thirdParty: thirdPartyMatches,
    topic: topicMatches,
  });
  const abuseMatches = containsPhrase(matchText, ABUSE_PHRASES);

  let positiveHits = 0;
  let negativeHits = 0;
  for (const t of tokens) {
    if (POSITIVE_WORDS.has(t)) positiveHits++;
    if (NEGATIVE_WORDS.has(t)) negativeHits++;
  }
  // Crisis/abuse phrases are strong negative evidence even when no single
  // token is in the lexicon ("I want to kill myself" has none) — without
  // this, a crisis message scores sentiment 0 / intensity 0.
  //
  // A bare topic mention is excluded: "suicide rates declined last year"
  // reports on a subject rather than expressing the speaker's state, and
  // scoring it as severe negative affect is what made educational text look
  // like a person in distress.
  const affectiveCrisisMatches =
    crisisContext === "topic_mention" ? 0 : firstPersonMatches.length + thirdPartyMatches.length;
  negativeHits += (affectiveCrisisMatches + abuseMatches.length) * 2;

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
  // Distress describes a person, so it applies when someone is at risk —
  // not to a message that merely discusses the subject.
  if (primaryEmotion === "neutral" && crisisContext && crisisContext !== "topic_mention") {
    primaryEmotion = "distress";
  }

  const intensity = tokens.length === 0 ? 0 : Math.min(1, totalHits / Math.max(4, tokens.length * 0.5));
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
    // null when no crisis vocabulary is present; otherwise who it refers to.
    crisis_context: crisisContext,
    matched_phrases: [...crisisMatches, ...abuseMatches],
    pii: {
      emails: emails.length,
      phones: phones.length,
    },
  };
}
