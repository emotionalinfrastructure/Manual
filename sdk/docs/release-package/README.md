# EIS SDK Release Package

This package contains the release layer for the Emotional Infrastructure™ Standard SDK v0.2.0.

## Included files

```text
README_RELEASE_CANDIDATE.md
npm/package.recommended.json
npm/RELEASE_CHECKLIST.md
npm/EXACT_SHIP_COMMANDS.md
github/workflows/ci.yml
docs/PRODUCT_BRIEF.md
docs/RELEASE_NOTES_v0.2.0.md
docs/POSITIONING_LANGUAGE.md
docs/RUNTIME_API_BUILD_PLAN.md
launch/LINKEDIN_LAUNCH_POST.md
launch/TECHNICAL_REVIEWER_EMAIL.md
review/PRE_RELEASE_FIXES.md
```

## Important boundary

This package does not include the full SDK source code. It builds the professional release system around the materials currently available: package metadata, README-level documentation, implementation summaries, and ecosystem audit notes.

Before public npm publication, place these files into the actual SDK repository and run the verification checklist.

## Recommended order

1. Put the actual SDK source into GitHub.
2. Add the CI workflow.
3. Replace README with the release-candidate README or merge its language into the main README.
4. Apply the pre-release documentation fixes.
5. Run local verification.
6. Push to GitHub and confirm CI passes.
7. Publish to npm.
8. Announce publicly.
