# The held-out split

The open corpus in `data/` cannot measure what matters most: whether a detector
catches disclosures phrased to slip past one. That requires a set of indirect,
coded, and evasive phrasings — and publishing that set to a public repository
hands anyone a list of ways to say you are in danger without a safety system
noticing.

So the adversarial split is **not in this repository, and will not be.**

## Why gate this and not the rest

The open split contains six indirect phrasings (`fp-ind-*`). They are here
because they were already published in this repo's README before this benchmark
existed — including them adds no exposure that hasn't already happened. That is
the whole boundary. Nothing new goes into the open split.

The reasoning is not that evasive phrasings are secret. They aren't; people at
risk arrive at them without instruction, which is precisely why detectors must
catch them. It is that a *curated, verified, ranked* list — one where each entry
has been confirmed to defeat named production systems — is a different artifact
from the phrasings themselves. Curation is the harm. A benchmark that publishes
its own answer key stops measuring detection and starts distributing an
evasion recipe.

## What the held-out split contains

- Indirect first-person disclosures beyond those already public.
- Coded and abbreviated forms, including platform-specific idiom.
- Phrasings that mimic benign speech closely enough to require context.
- Near-miss controls for each, so a system cannot score by escalating anything
  that resembles the evasive set.

Ground truth is labeled to the same `SCHEMA.md` as the open split.

## Requesting access

Access is granted to people who will be *measured* by it, not people who want to
read it.

1. Email `brittanywright@emotionalinfrastructure.org` with:
   - who you are and the system you intend to score;
   - whether results will be published, and where;
   - an adapter conforming to `adapters/template.mjs` that runs without
     modification.
2. Preferred fulfilment is **blind**: send the adapter, and scored results come
   back to you. The corpus itself never moves, which removes the leak surface
   entirely and is available to anyone regardless of affiliation.
3. Where blind scoring will not work — the system cannot be reached
   programmatically, or the evaluation requires iteration — the corpus is shared
   under a written agreement not to redistribute it, not to publish item text,
   and not to train on it.

Refusals are on record and are not negotiable by seniority: "we need to see the
items to improve our recall" is a request to train on the test set.

## Publishing results from it

Report aggregate numbers and per-category breakdowns. Do not quote item text.
Cite the corpus version (`held-out-vX.Y`) so the numbers can be reproduced.

If a system scores well and its authors want to demonstrate that, the blind
route already produces a signed result they can publish. Nobody needs the item
text to prove a score.

## Rotation

Any held-out version whose items appear to have leaked into training data or
public discussion is retired, not patched. Recall measured on a leaked split is
memorization. Retirement is announced with the version number and the date; the
scores from it stay published, marked retired, because withdrawing past results
would let a leak erase an unflattering number.

## Status

**No held-out split has been assembled yet.** This document is the protocol,
written before the data exists, because deciding access rules after you hold the
data is how they end up shaped by who is asking.
