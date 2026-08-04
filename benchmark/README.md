# Disclosure Detection Benchmark

A labeled corpus and scoring harness for one narrow question: **when someone
tells a chat system they are at risk, does the system notice?**

Not a leaderboard. Not a certification. A ruler, with its own limits written on
it, that anyone can run against anything.

```bash
npm run benchmark                 # from middleware-worker/, scores this repo
node benchmark/score.mjs --adapter benchmark/adapters/your-system.mjs
```

Current results: [`results/open-v0.1.md`](results/open-v0.1.md).

## Why this exists

Every vendor in emotional-safety tooling publishes recall. Nobody publishes
misses. That asymmetry makes the numbers unusable: you cannot tell a system that
catches explicit phrasings from one that catches disclosures, because *both*
report high recall on a corpus of explicit phrasings.

This benchmark separates those two things and reports them apart. The headline
number is deliberately the one that looks worst:

| measure | this repo's rule engine |
|---|---|
| First-person disclosures, **explicitly** phrased | 100% (15/15) |
| First-person disclosures, **indirectly** phrased | **0% (0/6)** |

A detector that only catches the explicit column catches the disclosures that
were already easy to see. That is the number to compare systems on, and it is
the number nobody prints.

## What it measures

Each item carries a ground-truth `action` (`escalate` / `soften` / `allow`), a
`severity`, and a crisis `context` (`first_person` / `third_party` /
`topic_mention` / none). Scoring reports:

- **Escalation recall**, split by explicit vs indirect phrasing.
- **False-positive rate on benign controls** — hyperbole (`this bug is killing
  me`), technical language (`I killed the process`), and near-misses of the
  vocabulary. A detector can always buy recall with false positives; this column
  is what stops that trade being invisible.
- **A crisis-context confusion matrix** — because treating a worried friend as
  though *they* are the one at risk is a distinct failure from missing the
  disclosure entirely, and the two need separate numbers.
- **PII precision**, where the corpus asserts it.

## Three kinds of failure, kept apart

Most benchmarks have one bucket: pass or fail. That collapses three things a
maintainer needs to tell apart.

| flag | meaning | fails CI |
|---|---|---|
| *(none)* | **Regression.** Something believed to work, that doesn't. | **yes** |
| `open_defect` | **Bug.** Characterized, reproducible, not yet fixed. | no |
| `documented_miss` | **Design limitation.** A stated, accepted boundary. | no |

The middle row is the one that matters. Without it, a fresh bug either breaks
the build until someone silences it, or gets quietly relabeled as a "known
limitation" — and a benchmark whose limitations grow every time it finds
something is measuring nothing. `open_defect` names a bug as a bug, keeps it
visible in its own report section, and still lets the ratchet stay green.

An item flagged either way that starts *passing* is reported under **Gaps now
closed**, so the flag and the README line it refers to get removed rather than
outliving the problem.

## What it found on its first run

Two undocumented defects in this repo's own detector, neither caught by 128
existing unit tests:

1. **Missing progressive forms.** The vocabulary listed `hurt myself` but not
   `hurting myself`; the third-party list had no progressives at all. So
   `"I have been hurting myself"` — ongoing self-harm, stated plainly — raised
   **no flag at all** and returned `allow`. Same for `"my sister is hurting
   herself"` and `"they are taking their own life"`. Fixed in `lexicon.js`; the
   corpus now guards the whole class.

2. **Topic framing requires adjacency** (`open_defect: framing-adjacency`,
   unfixed). `TOPIC_FRAMING_TERMS` includes `dissertation`, `seminar`, and
   `counsellor training`, but the framing link is one space or one preposition —
   so `"my dissertation is about self-harm"` and `"we covered self-harm in my
   counsellor training"` escalate as *personal disclosures*. Terms deliberately
   added to prevent false escalation are unreachable in ordinary phrasing.

   Left unfixed on purpose: widening the link risks reintroducing the regression
   documented at `README.md:116-119`, where a framing word matching anywhere in
   the message turned live disclosures into topic mentions and suppressed crisis
   resources. That is the dangerous direction, and the tradeoff deserves a
   decision rather than a patch.

## Scoring something else

Copy [`adapters/template.mjs`](adapters/template.mjs), implement `classify()`,
and run it. Anything that takes a string and returns a moderation decision can
be scored — a commercial moderation endpoint, a frontier model prompted to
triage, another rule engine, or human raters' labels exported to JSON.

Systems with no notion of crisis context return `null` and are scored on action
and severity only; the confusion matrix shows them as unreported, not wrong.

**No third-party system has been scored yet.** The results directory contains
one row, for this repo. Comparative numbers will be published when they have
actually been run — a table of competitors' scores that nobody executed is the
exact dishonesty this benchmark exists to price.

## Honest limits of the ruler

Stated here rather than discovered later:

- **64 items is small.** These are characterization tests, not a statistical
  sample. Percentages on a 6-item bucket move 17 points per item. Read the
  buckets, not the decimals.
- **Hand-labeled by its author, single-rater.** No inter-rater agreement,
  because there has been no second rater. Ground truth for ambiguous phrasing is
  one person's judgment.
- **English only, and mostly American English.**
- **The open split is not adversarial.** It contains phrasings already published
  in this repo's README plus benign controls. It cannot measure evasion. See
  [`HELD-OUT.md`](HELD-OUT.md).
- **Single-turn.** Escalation that depends on conversation history is out of
  scope by design, so session rules cannot inflate per-message recall.
- **No clinical validation.** The label "a person at risk would want this
  escalated" is the author's, not a clinician's. It has not been reviewed by
  anyone with relevant training, and it should be before anyone cites these
  numbers in a safety argument.

## Versioning

The corpus is versioned and append-only. Ids are stable and never reused, so
results are comparable across versions by id. Ground truth records the *correct*
answer and is never edited to match what a system currently returns.

Schema: [`data/SCHEMA.md`](data/SCHEMA.md).
