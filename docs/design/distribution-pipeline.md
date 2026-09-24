---
type: Design
title: The distribution pipeline
description: The automatic chain that ships new reconciler logic to consumers — CLI bump, auto-merge, semantic-release tag, and the consumer's own Dependabot pick-up.
tags: [design, releases, dependabot]
---

# The distribution pipeline

New versions of the reconciler reach consumers with no manual step at any hop. The
chain has two halves: producing a new Action release here, and consumers picking it
up. (The first half starts working once the CLI is pinned; see the
[overview](../overview.md) for status.)

## Producing a release (this repo)

1. **CLI bump.** `@rmartz/pr-lifecycle` publishes a new version to npmjs.
   Dependabot's npm ecosystem ([`dependabot.yml`](../../.github/dependabot.yml), no
   registry auth needed) opens a PR bumping the pinned
   dependency + lockfile, titled `fix(deps): bump @rmartz/pr-lifecycle …`.
2. **Map the release type.** The
   [`dependabot-release-type`](../../.github/workflows/dependabot-release-type.yml)
   workflow rewrites that title to mirror the CLI's semver bump — see the
   [versioning policy](versioning.md).
3. **Auto-merge.** The [`bot-automerge`](../../.github/workflows/bot-automerge.yml)
   caller enables native auto-merge on the patch/minor bump. It lands once the
   required checks pass — CI plus the
   [`merge-safety`](https://github.com/rmartz/merge-safety) verdict.
4. **Release.** On merge to `main`, [`release.yml`](../../.github/workflows/release.yml)
   runs semantic-release with the conventionalcommits preset
   ([`.releaserc.json`](../../.releaserc.json)), cutting a tag + GitHub Release. It
   publishes nothing to a registry and commits nothing back, so the built-in
   `GITHUB_TOKEN` suffices. The `Release dry-run` job in
   [`ci.yml`](../../.github/workflows/ci.yml) renders the release notes on every PR,
   so a broken release toolchain fails the PR rather than silently stalling this
   chain after an auto-merge.

A **major** CLI bump falls out of the auto-merge set into its own PR for a human to
review.

## Picking it up (consumers)

5. **Consumer Dependabot.** Each consumer pins this Action by SHA
   (`uses: rmartz/pr-lifecycle-action@<sha> # vX.Y.Z`) and runs Dependabot's
   `github-actions` ecosystem, which opens a PR bumping that pin to the new release.
6. **New logic takes effect** the moment the consumer merges the bump — no edit to
   their caller.
