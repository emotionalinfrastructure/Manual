import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeMessage } from "./lexicon.js";

// --- Emotion classification -------------------------------------------------

test("detects joy", () => {
  assert.equal(analyzeMessage("I am so happy and excited").primary_emotion, "joy");
});

test("detects sadness", () => {
  assert.equal(analyzeMessage("I feel sad, empty and hopeless").primary_emotion, "sadness");
});

test("detects anger", () => {
  assert.equal(analyzeMessage("I am furious and angry about this").primary_emotion, "anger");
});

test("detects fear", () => {
  assert.equal(analyzeMessage("I am so anxious and scared").primary_emotion, "fear");
});

test("detects gratitude", () => {
  assert.equal(analyzeMessage("thanks, I really appreciate it").primary_emotion, "gratitude");
});

test("non-emotional text is neutral", () => {
  const r = analyzeMessage("the cat sat on the mat");
  assert.equal(r.primary_emotion, "neutral");
  assert.equal(r.sentiment_score, 0);
  assert.equal(r.intensity, 0);
  assert.deepEqual(r.flags, []);
});

test("emotion ties resolve to the first-declared emotion (joy before sadness)", () => {
  // One joy word + one sadness word: documents the current tie-break, which
  // favours whichever emotion appears earliest in EMOTION_LEXICON.
  const r = analyzeMessage("happy sad");
  assert.equal(r.primary_emotion, "joy");
  assert.equal(r.sentiment_score, 0); // one positive, one negative -> net zero
});

// --- Sentiment / intensity with no lexicon hits -----------------------------

test("sentiment and intensity are zero when there are no lexicon hits", () => {
  const r = analyzeMessage("please schedule the meeting for noon");
  assert.equal(r.sentiment_score, 0);
  assert.equal(r.intensity, 0);
  assert.equal(r.primary_emotion, "neutral");
});

// --- Empty / nullish / whitespace inputs ------------------------------------

test("empty string is handled without throwing", () => {
  const r = analyzeMessage("");
  assert.equal(r.primary_emotion, "neutral");
  assert.equal(r.sentiment_score, 0);
  assert.equal(r.intensity, 0);
  assert.deepEqual(r.flags, []);
  assert.deepEqual(r.matched_phrases, []);
  assert.deepEqual(r.pii, { emails: 0, phones: 0 });
});

test("whitespace-only string is treated as empty", () => {
  const r = analyzeMessage("    \t  \n ");
  assert.equal(r.primary_emotion, "neutral");
  assert.equal(r.sentiment_score, 0);
  assert.equal(r.intensity, 0);
  assert.deepEqual(r.flags, []);
});

test("null input does not throw and returns neutral analysis", () => {
  const r = analyzeMessage(null);
  assert.equal(r.primary_emotion, "neutral");
  assert.deepEqual(r.flags, []);
  assert.deepEqual(r.pii, { emails: 0, phones: 0 });
});

test("undefined input does not throw and returns neutral analysis", () => {
  const r = analyzeMessage(undefined);
  assert.equal(r.primary_emotion, "neutral");
  assert.deepEqual(r.flags, []);
});

// --- Safety flags: crisis / abuse -------------------------------------------

test("crisis language raises the crisis flag and records the matched phrase exactly", () => {
  const r = analyzeMessage("I want to kill myself");
  assert.ok(r.flags.includes("crisis_language"));
  assert.deepEqual(r.matched_phrases, ["kill myself"]);
});

test("abusive language raises the abuse flag and records the matched phrase exactly", () => {
  const r = analyzeMessage("shut up and die");
  assert.ok(r.flags.includes("abusive_language"));
  assert.ok(!r.flags.includes("crisis_language"));
  assert.deepEqual(r.matched_phrases, ["shut up and die"]);
});

// --- PII detection ----------------------------------------------------------

test("detects an email address as PII", () => {
  const r = analyzeMessage("email me at test@example.com please");
  assert.ok(r.flags.includes("pii_detected"));
  assert.equal(r.pii.emails, 1);
  assert.equal(r.pii.phones, 0);
});

test("detects a phone number as PII", () => {
  const r = analyzeMessage("call me at 555-123-4567");
  assert.ok(r.flags.includes("pii_detected"));
  assert.equal(r.pii.phones, 1);
  assert.equal(r.pii.emails, 0);
});

// --- Overlapping / multiple signal classes ----------------------------------

test("a message carrying crisis, abuse and negative sentiment flags all applicable classes", () => {
  const r = analyzeMessage("I hate you and I want to die");
  assert.ok(r.flags.includes("crisis_language"));
  assert.ok(r.flags.includes("abusive_language"));
  // matched_phrases lists crisis matches before abuse matches.
  assert.deepEqual(r.matched_phrases, ["want to die", "i hate you"]);
  assert.ok(r.sentiment_score < 0);
});

test("crisis language combined with PII flags both classes", () => {
  const r = analyzeMessage("I want to kill myself, reach me at a@b.com");
  assert.ok(r.flags.includes("crisis_language"));
  assert.ok(r.flags.includes("pii_detected"));
  assert.equal(r.pii.emails, 1);
  assert.deepEqual(r.matched_phrases, ["kill myself"]);
});

// --- Crisis context classification ------------------------------------------
//
// Detection is deliberately unchanged: every message below still raises
// `crisis_language`. What `crisis_context` adds is *who* the language refers
// to, so the policy layer can respond proportionately instead of treating a
// statistic and a disclosure as the same event.

test("first-person disclosure is classified as first_person", () => {
  for (const msg of [
    "I want to kill myself",
    "I am suicidal",
    "I have been feeling suicidal lately",
    "there is no reason to live anymore",
    "I would be better off dead",
  ]) {
    const r = analyzeMessage(msg);
    assert.ok(r.flags.includes("crisis_language"), msg);
    assert.equal(r.crisis_context, "first_person", msg);
  }
});

test("concern about another person is classified as third_party", () => {
  for (const msg of [
    "My friend said she wants to kill herself",
    "He told me he wants to end his life",
    "my brother is suicidal and I don't know what to do",
    "someone I know is suicidal",
  ]) {
    const r = analyzeMessage(msg);
    assert.ok(r.flags.includes("crisis_language"), msg);
    assert.equal(r.crisis_context, "third_party", msg);
  }
});

test("third-party phrasings are now detected at all (previously a false negative)", () => {
  // Before the context split these matched no phrase entry and passed
  // through entirely unflagged.
  const r = analyzeMessage("My friend said she wants to kill herself");
  assert.ok(r.flags.includes("crisis_language"));
  assert.deepEqual(r.matched_phrases, ["kill herself"]);
});

test("subject-matter discussion is classified as topic_mention", () => {
  for (const msg of [
    "Suicide rates among teenagers declined last year",
    "The history lecture covered ritual suicide in feudal Japan",
    "I am researching suicide prevention policy",
    "I am writing a paper on suicide statistics",
  ]) {
    const r = analyzeMessage(msg);
    assert.ok(r.flags.includes("crisis_language"), msg); // still detected
    assert.equal(r.crisis_context, "topic_mention", msg);
  }
});

test("a topic mention is not scored as the speaker's distress", () => {
  const r = analyzeMessage("Suicide rates among teenagers declined last year");
  assert.equal(r.crisis_context, "topic_mention");
  assert.equal(r.primary_emotion, "neutral"); // not "distress"
  assert.equal(r.sentiment_score, 0); // reporting a fact, not expressing affect
});

test("a disclosure inside academic framing is still a disclosure", () => {
  // Framing only reclassifies bare topic words. An explicit self-referential
  // phrase must never be explained away by surrounding context.
  const r = analyzeMessage("I'm writing a paper on suicide but honestly I want to kill myself");
  assert.equal(r.crisis_context, "first_person");
  assert.equal(r.primary_emotion, "distress");
});

test("third-party subject wins over an incidental first-person pronoun", () => {
  // "my friend" contains "my"; the sentence is still about someone else.
  const r = analyzeMessage("my friend is suicidal and I am worried");
  assert.equal(r.crisis_context, "third_party");
});

test("crisis_context is null when no crisis vocabulary is present", () => {
  assert.equal(analyzeMessage("the weather is lovely today").crisis_context, null);
  assert.equal(analyzeMessage("I feel sad and hopeless").crisis_context, null);
});

test("characterization: quoted first-person speech is still read as a disclosure", () => {
  // Known, deliberate limitation. Substring matching cannot reliably tell
  // quotation from disclosure, and over-offering support is the safe error.
  const r = analyzeMessage('She texted me "I want to kill myself" last night');
  assert.equal(r.crisis_context, "first_person");
});
