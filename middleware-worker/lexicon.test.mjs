import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeMessage } from "./lexicon.js";

// --- baseline scoring ---

test("empty and non-lexicon text scores neutral zero", () => {
  for (const text of ["", "the meeting is at three", "please pass the salt"]) {
    const a = analyzeMessage(text);
    assert.equal(a.sentiment_score, 0, text);
    assert.equal(a.primary_emotion, "neutral", text);
    assert.equal(a.intensity, 0, text);
    assert.deepEqual(a.flags, [], text);
  }
});

test("undefined input is treated as empty", () => {
  const a = analyzeMessage(undefined);
  assert.equal(a.sentiment_score, 0);
  assert.deepEqual(a.flags, []);
});

test("positive lexicon words yield positive sentiment and a positive emotion", () => {
  const a = analyzeMessage("I'm so happy and excited, this is wonderful");
  assert.ok(a.sentiment_score > 0);
  assert.equal(a.primary_emotion, "joy");
  assert.ok(a.intensity > 0);
});

test("gratitude words map to the gratitude emotion", () => {
  const a = analyzeMessage("thanks, I really appreciate it");
  assert.equal(a.primary_emotion, "gratitude");
  assert.ok(a.sentiment_score > 0);
});

test("negative lexicon words yield negative sentiment with the dominant emotion", () => {
  const sad = analyzeMessage("I feel sad and lonely and hopeless");
  assert.ok(sad.sentiment_score < 0);
  assert.equal(sad.primary_emotion, "sadness");

  const angry = analyzeMessage("I'm furious and mad about this");
  assert.ok(angry.sentiment_score < 0);
  assert.equal(angry.primary_emotion, "anger");

  const afraid = analyzeMessage("I'm scared and anxious and worried");
  assert.ok(afraid.sentiment_score < 0);
  assert.equal(afraid.primary_emotion, "fear");
});

test("mixed positive and negative words produce an intermediate score", () => {
  const a = analyzeMessage("I'm happy about the offer but worried about the move");
  assert.ok(a.sentiment_score > -1 && a.sentiment_score < 1);
});

// --- crisis and abuse phrases ---

test("crisis phrase with no lexicon tokens still scores as negative distress", () => {
  const a = analyzeMessage("I want to kill myself");
  assert.deepEqual(a.flags, ["crisis_language"]);
  assert.ok(a.sentiment_score < 0);
  assert.equal(a.primary_emotion, "distress");
  assert.ok(a.intensity > 0);
  assert.ok(a.matched_phrases.includes("kill myself"));
});

test("crisis phrase alongside a lexicon emotion keeps the narrower emotion label", () => {
  const a = analyzeMessage("I feel hopeless, like there is no reason to live");
  assert.ok(a.flags.includes("crisis_language"));
  assert.equal(a.primary_emotion, "sadness"); // narrower than distress, so kept
  assert.ok(a.sentiment_score < 0);
});

test("abusive phrases flag and score negative without the distress label", () => {
  const a = analyzeMessage("shut up and die, you're worthless");
  assert.ok(a.flags.includes("abusive_language"));
  assert.ok(!a.flags.includes("crisis_language"));
  assert.ok(a.sentiment_score < 0);
  assert.notEqual(a.primary_emotion, "distress"); // distress is reserved for crisis
});

// --- PII detection and stacking ---

test("email addresses are detected and counted", () => {
  const a = analyzeMessage("reach me at jane.doe@example.com");
  assert.deepEqual(a.flags, ["pii_detected"]);
  assert.equal(a.pii.emails, 1);
  assert.equal(a.pii.phones, 0);
});

test("phone numbers are detected and counted", () => {
  const a = analyzeMessage("call me at +1 (555) 123-4567 tomorrow");
  assert.deepEqual(a.flags, ["pii_detected"]);
  assert.equal(a.pii.phones, 1);
  assert.equal(a.pii.emails, 0);
});

test("PII stacks with emotional and crisis flags", () => {
  const a = analyzeMessage("I want to kill myself, my number is 555-123-4567");
  assert.deepEqual(a.flags, ["crisis_language", "pii_detected"]);
  assert.equal(a.primary_emotion, "distress");
  assert.equal(a.pii.phones, 1);
});

// --- phone-number false positives (CHARACTERIZATION of a known defect) ---
//
// KNOWN DEFECT (documented, not fixed here): PHONE_RE = /\b(\+?\d[\d\s().-]{7,}\d)\b/g
// matches any long run of digits/separators, so non-phone numeric identifiers
// are misclassified as phone PII. These tests PIN the current (incorrect)
// behavior so a future regex fix is a deliberate, reviewed change — see the PR
// description's defect note. Do NOT "fix" these by editing the assertions; a
// corrected regex should flip them to 0 in the same change that discloses it.

test("DEFECT: an order number is misclassified as a phone (false positive)", () => {
  const a = analyzeMessage("my order number is 100002345678");
  assert.equal(a.pii.phones, 1); // should be 0 once the regex is narrowed
  assert.ok(a.flags.includes("pii_detected"));
});

test("DEFECT: a bare date is misclassified as a phone (false positive)", () => {
  const a = analyzeMessage("the date was 2026-07-22");
  assert.equal(a.pii.phones, 1); // should be 0
});

test("DEFECT: a long numeric id is misclassified as a phone (false positive)", () => {
  const a = analyzeMessage("user id 123456789012345");
  assert.equal(a.pii.phones, 1); // should be 0
});

test("DEFECT: an ISBN-like value is misclassified as a phone (false positive)", () => {
  const a = analyzeMessage("isbn 978-0-13-468599-1");
  assert.equal(a.pii.phones, 1); // should be 0
});

test("a short formatted value below the digit threshold is NOT a phone (correct)", () => {
  const a = analyzeMessage("extension 12-34");
  assert.equal(a.pii.phones, 0);
  assert.ok(!a.flags.includes("pii_detected"));
});

test("a timestamp broken by a 'T' separator is not one phone run (correct)", () => {
  const a = analyzeMessage("event at 2026-07-22T12:00:00");
  assert.equal(a.pii.phones, 0);
});

// --- characterization: current contextual-language behavior ---
//
// These tests DOCUMENT the present keyword/phrase behavior; they are not an
// endorsement of it. The detector matches literal substrings: first-person
// phrase entries miss third-person phrasings, while bare keywords
// ("suicide", "suicidal") match quoted, educational, and historical
// mentions. Distinguishing first-person imminent-risk language from
// mention/quotation is a planned, separate policy-boundary change — when it
// lands, these assertions are expected to be revised deliberately.

test("characterization: third-person phrasings are NOT currently flagged", () => {
  const a1 = analyzeMessage("My friend said she wants to kill herself");
  assert.deepEqual(a1.flags, []);

  const a2 = analyzeMessage("He told me he wants to end his life");
  assert.deepEqual(a2.flags, []);
});

test("characterization: quoted first-person speech IS currently flagged", () => {
  const a = analyzeMessage('She texted me "I want to kill myself" last night');
  assert.ok(a.flags.includes("crisis_language"));
});

test("characterization: educational/statistical keyword mentions ARE currently flagged", () => {
  const a1 = analyzeMessage("Suicide rates among teenagers declined last year");
  assert.ok(a1.flags.includes("crisis_language"));

  const a2 = analyzeMessage("The history lecture covered ritual suicide in feudal Japan");
  assert.ok(a2.flags.includes("crisis_language"));
});
