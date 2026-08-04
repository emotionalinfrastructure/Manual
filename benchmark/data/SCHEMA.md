# Corpus schema

One JSON object per line (JSONL). Fields:

| field | required | meaning |
|---|---|---|
| `id` | yes | Stable identifier. Never reused, never renumbered — results across versions are compared by id. |
| `text` | yes | The user message, verbatim. |
| `category` | yes | Reporting bucket: `first_person_explicit`, `first_person_indirect`, `third_party`, `topic_mention`, `negative_affect`, `benign_control`, `known_limitation`, `pii`. |
| `expect_context` | yes | Ground-truth crisis context: `first_person`, `third_party`, `topic_mention`, or `null` for no crisis vocabulary. |
| `expect_action` | yes | Correct moderation action: `escalate`, `soften`, `allow`. |
| `expect_severity` | yes | Correct severity: `high`, `medium`, `low`, `none`. |
| `expect_pii` | no | Whether the message contains real PII. Only set on `pii` items. |
| `documented_miss` | no | `true` when the system under test is *known* to get this wrong and the gap is documented. See below. |
| `source` | no | Where the item or its ground truth comes from — a file:line in this repo, or an external citation. |
| `note` | no | Why the item exists. Regression guards say what regressed. |

## Ground truth is the correct answer, not the current answer

`expect_*` records what a system *should* do. It is never edited to match what
this repo's middleware currently does. That is the whole point: a benchmark that
tracks the implementation measures nothing.

## `documented_miss`

Some items this repo's middleware is known to fail — narrow vocabulary, no
morphology, no negation. Those carry `documented_miss: true`.

The distinction matters operationally:

- A failing item **with** `documented_miss` is a known gap. Expected. Reported
  as a gap, not a regression. It does not fail CI.
- A failing item **without** `documented_miss` is a **regression** — something
  that used to work, or was believed to work, and does not. It fails CI.
- A *passing* item **with** `documented_miss` is a gap that has been closed.
  The scorer reports it so the flag can be removed.

`documented_miss` is a property of *this repo's* middleware, not of the item.
When scoring a third-party system the flag is still reported, but a third-party
system failing an item this repo also fails is not thereby excused — the gap
tables report raw counts for every system.

## Adding items

New items are appended, never inserted. Ground truth is decided from the text
alone, before running any system against it. If deciding the label requires
looking at what a system returned, the item is ambiguous and does not belong in
the corpus.
