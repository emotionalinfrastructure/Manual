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

// --- Subject resolution: who the crisis vocabulary is actually about ---------
//
// The classifier previously scanned the whole message for a third-party marker
// and checked it before any first-person marker. Bare pronouns are everywhere,
// so a disclosure carrying one anywhere — including after the disclosure, about
// someone entirely incidental — was read as concern for that other person:
// severity dropped high -> medium, the directive told the model not to treat
// the user as personally at risk, and crisis_turn_count never incremented, so
// repeated-crisis escalation could never fire for that user.

test("an incidental third-person pronoun does not downgrade a disclosure", () => {
  for (const msg of [
    "I am suicidal and she knows",
    "I am suicidal, they left me",
    "I am suicidal because of him",
    "I am suicidal because my brother died last year",
    "I've been suicidal since the divorce, my wife left",
    "I want to self-harm, their words hurt",
  ]) {
    assert.equal(analyzeMessage(msg).crisis_context, "first_person", msg);
  }
});

test("a named third party before the vocabulary still wins", () => {
  for (const msg of [
    "my friend is suicidal and I am worried",
    "someone I know is suicidal",
    "I think my brother is suicidal",
    "he told me he's suicidal",
  ]) {
    assert.equal(analyzeMessage(msg).crisis_context, "third_party", msg);
  }
});

test("a subject trailing its predicate is still resolved", () => {
  assert.equal(analyzeMessage("suicidal thoughts have been with me all week").crisis_context, "first_person");
  assert.equal(
    analyzeMessage("suicide is what she has been talking about all week").crisis_context,
    "third_party"
  );
});

// --- Topic framing must be tied to the topic word ---------------------------

test("ordinary words no longer reclassify a disclosure as subject matter", () => {
  // "class", "book", "paper", "study", "survey" are everyday vocabulary. Any
  // of them anywhere in the message used to turn a live disclosure into a
  // topic_mention, which is an `allow` carrying a directive that explicitly
  // instructs the model *not* to surface crisis resources.
  for (const msg of [
    "I'm suicidal, I can't focus in class",
    "I'm suicidal and I can't finish this paper",
    "I feel suicidal, I've been reading a book about grief",
    "I want to self-harm, the survey at work was the last straw",
    "I'm suicidal, my study group doesn't know",
  ]) {
    assert.equal(analyzeMessage(msg).crisis_context, "first_person", msg);
  }
});

test("framing tied to the topic word still reads as subject matter", () => {
  for (const msg of [
    "I am researching suicide prevention policy",
    "I am writing a paper on suicide statistics",
    "my dissertation on self-harm is due",
    "the documentary about suicide was hard to watch",
  ]) {
    assert.equal(analyzeMessage(msg).crisis_context, "topic_mention", msg);
  }
});

// --- Vocabulary carrying no subject of its own ------------------------------

test("ambiguous crisis phrases resolve by subject rather than assuming either", () => {
  assert.equal(analyzeMessage("I don't want to be here anymore").crisis_context, "first_person");
  assert.equal(analyzeMessage("my friend doesn't want to be here anymore").crisis_context, "third_party");
  assert.equal(analyzeMessage("she says she'd be better off dead").crisis_context, "third_party");
});

test("an ambiguous phrase with no subject at all defaults to the riskier reading", () => {
  // "no reason to live" names nobody, and neither does the rest of the
  // sentence. A missed disclosure costs more than an unnecessary offer.
  assert.equal(analyzeMessage("there is no reason to live anymore").crisis_context, "first_person");
});

test("phrasings that previously passed through unflagged are detected", () => {
  for (const msg of [
    "I don't want to be here anymore",
    "I don't want to wake up tomorrow",
    "I'm going to take my own life",
    "I want to off myself",
    "I've been thinking about unaliving myself",
    "I just want to end it all",
  ]) {
    const r = analyzeMessage(msg);
    assert.ok(r.flags.includes("crisis_language"), msg);
    assert.equal(r.crisis_context, "first_person", msg);
  }
});

test("'off myself' does not fire on ordinary use of the same words", () => {
  // The phrase is listed as "to off myself" precisely so this stays clean.
  assert.deepEqual(analyzeMessage("I finished it off myself").flags, []);
});

// --- Intensity is magnitude, not density ------------------------------------

test("intensity does not fall as the user writes more about the same feelings", () => {
  // Intensity used to divide by token count, so explaining yourself lowered it
  // — and policy.js gates softening on an intensity floor, which meant the
  // longer and more vulnerable the message, the less likely it was answered
  // with empathy.
  const short = analyzeMessage("I feel sad and hopeless");
  const long = analyzeMessage(
    "I feel sad and hopeless about everything that has happened to me this year, and honestly " +
      "I do not know who to talk to about it anymore because everyone around me seems busy with " +
      "their own lives and I do not want to be a burden on any of them."
  );
  assert.equal(long.intensity, short.intensity);
  assert.ok(long.intensity >= 0.3, "must clear the soften threshold in policy.js");
});

test("intensity still scales with how much affect is present", () => {
  assert.ok(analyzeMessage("I feel sad").intensity < analyzeMessage("I feel sad, empty and hopeless").intensity);
  assert.equal(analyzeMessage("the cat sat on the mat").intensity, 0);
});

// Regression: substring matching has no morphology, so every base phrase needs
// its progressive listed alongside it. "hurt myself" was present and "hurting
// myself" was not, and the third-party list carried no progressives at all, so
// plainly-stated ongoing self-harm raised no flag and returned action "allow".
// Found by benchmark/, not by the unit suite — hence this test.
test("progressive forms of crisis phrases are detected, not just the base form", () => {
  for (const text of [
    "I have been hurting myself",
    "I have been harming myself for months",
  ]) {
    const analysis = analyzeMessage(text);
    assert.ok(analysis.flags.includes("crisis_language"), `no crisis flag for: ${text}`);
    assert.equal(analysis.crisis_context, "first_person", text);
  }

  for (const text of [
    "my sister is hurting herself",
    "she's been talking about ending her life",
    "they are taking their own life",
  ]) {
    const analysis = analyzeMessage(text);
    assert.ok(analysis.flags.includes("crisis_language"), `no crisis flag for: ${text}`);
    assert.equal(analysis.crisis_context, "third_party", text);
  }
});
