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
// crisis-detection service instead of a keyword list. Measured recall on
// plainly-phrased first-person disclosures is partial, not broad; see the
// README. What this vocabulary buys is a *proportionate response* to the
// phrasings it does catch, telling "I want to kill myself" apart from
// "suicide rates declined last year" instead of treating both as imminent risk.
//
// The vocabulary is split by what a match tells you on its own:
//
//   self-referential  the phrase names the speaker      -> first_person
//   third-party       the phrase names someone else     -> third_party
//   ambiguous         a disclosure with no named subject -> resolve the subject
//   topic keywords    the subject discussed at all       -> resolve the subject
//
// Only the first two are self-evident. The last two are decided by
// resolveCrisisSubject below, which reads who the sentence is actually about.

// Inherently self-referential: the phrase itself names the speaker, so a match
// is a disclosure no matter what surrounds it.
export const SELF_REFERENTIAL_CRISIS_PHRASES = [
  "kill myself",
  "killing myself",
  "end my life",
  "ending my life",
  "hurt myself",
  "harm myself",
  "take my own life",
  "taking my own life",
  "to off myself", // "to" keeps "I finished it off myself" from matching
  "unalive myself",
  "unaliving myself",
  "wish i was dead",
  "wish i were dead",
];

// Someone describing another person — usually a user seeking help for a
// friend or family member. Previously undetected entirely (a false negative).
export const THIRD_PARTY_CRISIS_PHRASES = [
  "kill herself",
  "kill himself",
  "kill themselves",
  "killing herself",
  "killing himself",
  "killing themselves",
  "end her life",
  "end his life",
  "end their life",
  "hurt herself",
  "hurt himself",
  "hurt themselves",
  "harm herself",
  "harm himself",
  "harm themselves",
  "take her own life",
  "take his own life",
  "take their own life",
];

// Unmistakably crisis vocabulary, but carrying no subject of its own: "no
// reason to live" is a disclosure from a user and a report from a worried
// friend. Previously either absent from the lexicon entirely (a false
// negative) or listed as first-person and so misread when someone else was
// the subject.
export const AMBIGUOUS_CRISIS_PHRASES = [
  "want to die",
  "wants to die",
  "wanna die",
  "want to be dead",
  "no reason to live",
  "no reason to go on",
  "better off dead",
  "end it all",
  "ending it all",
  // Listed without the negation so one entry covers don't / doesn't / didn't /
  // dont. "want to be here anymore" and "want to live anymore" only occur in
  // English under a negation, so dropping it costs no precision — unlike
  // "want to wake up", which is an ordinary thing to say.
  "want to be here anymore",
  "want to live anymore",
  "don't want to wake up",
  "dont want to wake up",
  "doesn't want to wake up",
];

// Topic words. Alone they carry no information about who is at risk: they
// appear in disclosures, in third-party concern, and in news, research, and
// history alike. Subject resolution below decides which.
export const CRISIS_TOPIC_KEYWORDS = ["suicidal", "suicide", "self harm", "self-harm"];

// Retained as the union for callers that just want "is any crisis vocabulary
// present", independent of who it refers to.
export const CRISIS_PHRASES = [
  ...SELF_REFERENTIAL_CRISIS_PHRASES,
  ...THIRD_PARTY_CRISIS_PHRASES,
  ...AMBIGUOUS_CRISIS_PHRASES,
  ...CRISIS_TOPIC_KEYWORDS,
];

// An explicitly named other person. Strong evidence: these appear in sentences
// that are about someone else even when the user also refers to themselves
// ("someone I know is suicidal"), so a match before the crisis vocabulary
// settles the question outright.
const STRONG_THIRD_PARTY_RE =
  /\b(my (friend|brother|sister|son|daughter|child|kid|mom|mum|dad|mother|father|parent|parents|partner|wife|husband|boyfriend|girlfriend|colleague|coworker|classmate|student|patient|neighbou?r|cousin|aunt|uncle)|someone|somebody|a friend)\b/;

// Bare pronouns. Much weaker evidence: they turn up constantly in sentences
// that are unmistakably about the speaker ("I am suicidal and she knows"), so
// treating them as third-party markers wherever they appear silently
// downgraded real disclosures. They decide the classification only when they
// are the *nearest* subject before the crisis vocabulary.
const WEAK_THIRD_PARTY_RE = /\b(he|him|his|she|her|hers|they|them|their)\b/;

// "i" also covers "i'm", "i've", "i'll" — the apostrophe is a word boundary.
const FIRST_PERSON_SUBJECT_RE = /\b(i|me|my|myself)\b/;

// Academic, professional, or journalistic framing *tied to* a topic word:
// "researching suicide", "a paper on suicide", "suicide statistics". The link
// is one space or one preposition, deliberately — matching a framing word
// anywhere in the message meant that ordinary words ("class", "book", "this
// paper") reclassified live disclosures as subject matter and suppressed the
// crisis response. Only consulted when a bare topic word matched: an explicit
// phrase is never reclassified by framing, so "I'm writing a paper and I want
// to kill myself" still reads as a disclosure.
const TOPIC_FRAMING_TERMS =
  "research(?:ing|er|ers)?|stud(?:y|ying|ies|ied)|paper|article|essay|thesis|dissertation|" +
  "journalis(?:m|t)|reporting|statistics?|documentary|coursework|lecture|seminar|curriculum|" +
  "prevention (?:policy|programmes?|programs?|campaign|training)|hotline (?:staff|volunteer)|" +
  "counsell?or training";
const CRISIS_TOPIC_PATTERN = "suicidal|suicide|self[ -]?harm";
const FRAMING_LINK = "(?:\\s+(?:on|about|into|of|regarding|concerning|surrounding)\\s+|\\s+)";
const TOPIC_FRAMING_RE = new RegExp(
  `\\b(?:${TOPIC_FRAMING_TERMS})${FRAMING_LINK}(?:${CRISIS_TOPIC_PATTERN})\\b|` +
    `\\b(?:${CRISIS_TOPIC_PATTERN})${FRAMING_LINK}(?:${TOPIC_FRAMING_TERMS})\\b`
);

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

/** Index of the last match of `re` in `text`, or -1. */
function lastMatchIndex(re, text) {
  const scan = new RegExp(re.source, "g");
  let last = -1;
  let match;
  while ((match = scan.exec(text)) !== null) {
    last = match.index;
    if (match.index === scan.lastIndex) scan.lastIndex++; // guard zero-width
  }
  return last;
}

/** Earliest position at which any of `phrases` occurs in `text`. */
function earliestPhraseIndex(text, phrases) {
  let earliest = text.length;
  for (const phrase of phrases) {
    const at = text.indexOf(phrase);
    if (at !== -1 && at < earliest) earliest = at;
  }
  return earliest;
}

/**
 * Who is the crisis vocabulary about, when the phrase itself does not say?
 *
 * Only the text *before* the vocabulary is considered: a subject that appears
 * afterwards says nothing about whose crisis it is. "I am suicidal because my
 * brother died" is a disclosure; scanning the whole message for a third-party
 * marker read it as concern for the brother, dropped it from high to medium
 * severity, and told the model not to treat the user as personally at risk.
 *
 * Returns "first_person", "third_party", or null when no subject is found.
 */
function resolveCrisisSubject(lowerText, vocabularyStart) {
  const before = lowerText.slice(0, vocabularyStart);

  // An explicitly named person outranks position: in "someone I know is
  // suicidal" the nearest subject is "I", but the sentence is about someone.
  if (STRONG_THIRD_PARTY_RE.test(before)) return "third_party";

  const firstPersonAt = lastMatchIndex(FIRST_PERSON_SUBJECT_RE, before);
  const pronounAt = lastMatchIndex(WEAK_THIRD_PARTY_RE, before);
  if (firstPersonAt >= 0 || pronounAt >= 0) {
    return pronounAt > firstPersonAt ? "third_party" : "first_person";
  }

  // Nothing before the vocabulary. Fall back to the message as a whole, which
  // catches subjects that trail their predicate ("suicidal thoughts have been
  // with me all week").
  if (FIRST_PERSON_SUBJECT_RE.test(lowerText)) return "first_person";
  if (STRONG_THIRD_PARTY_RE.test(lowerText) || WEAK_THIRD_PARTY_RE.test(lowerText)) {
    return "third_party";
  }
  return null;
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
export function classifyCrisisContext(lowerText, { selfReferential, thirdParty, ambiguous, topic }) {
  if (selfReferential.length) return "first_person";
  if (thirdParty.length) return "third_party";
  if (!ambiguous.length && !topic.length) return null;

  const subject = resolveCrisisSubject(
    lowerText,
    earliestPhraseIndex(lowerText, [...ambiguous, ...topic])
  );

  // "I am suicidal" is a disclosure; "I am researching suicide" is not. Only a
  // bare topic word can be reclassified this way — an explicit phrase means
  // what it says regardless of what else is in the sentence.
  if (subject === "first_person" && !ambiguous.length && TOPIC_FRAMING_RE.test(lowerText)) {
    return "topic_mention";
  }
  if (subject) return subject;

  // No subject anywhere. An explicit phrase still defaults to the riskier
  // reading — an unnecessary offer of support is a far cheaper error than a
  // missed disclosure — while a bare topic word defaults to subject matter.
  return ambiguous.length ? "first_person" : "topic_mention";
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

  const selfReferentialMatches = containsPhrase(lowerText, SELF_REFERENTIAL_CRISIS_PHRASES);
  const thirdPartyMatches = containsPhrase(lowerText, THIRD_PARTY_CRISIS_PHRASES);
  const ambiguousMatches = containsPhrase(lowerText, AMBIGUOUS_CRISIS_PHRASES);
  const topicMatches = containsPhrase(lowerText, CRISIS_TOPIC_KEYWORDS);
  const crisisMatches = [
    ...selfReferentialMatches,
    ...thirdPartyMatches,
    ...ambiguousMatches,
    ...topicMatches,
  ];
  const crisisContext = classifyCrisisContext(lowerText, {
    selfReferential: selfReferentialMatches,
    thirdParty: thirdPartyMatches,
    ambiguous: ambiguousMatches,
    topic: topicMatches,
  });
  const abuseMatches = containsPhrase(lowerText, ABUSE_PHRASES);

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
    crisisContext === null || crisisContext === "topic_mention" ? 0 : crisisMatches.length;
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

  // Magnitude of affect, deliberately independent of message length. Dividing
  // by token count made intensity a density measure, so the same distress
  // scored lower the more the user explained it ("I feel sad and hopeless" =
  // 0.5, the same sentence with two clauses of context = 0.08) — and the
  // policy layer's soften rule has an intensity floor, so writing more about
  // your feelings was what stopped the middleware responding to them.
  const INTENSITY_SATURATION = 3; // affective hits at which intensity reaches 1
  const intensity = Math.min(1, totalHits / INTENSITY_SATURATION);
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
