---
type: Reference
title: What pr-lifecycle-action is
description: The composite Action that will wrap the @rmartz/pr-lifecycle CLI, its current scaffold status, and the proposed CLI contract it builds against.
tags: [action, overview, ci, auto-merge]
---

# What pr-lifecycle-action is

`pr-lifecycle-action` is the **composite GitHub Action** that runs the
[`@rmartz/pr-lifecycle`](https://github.com/rmartz/pr-lifecycle) reconciler in a
consuming repo. The reconciler recomputes a PR's lifecycle state from its current
facts on every relevant event, converges the PR's labels to match, and arms
GitHub-native auto-merge when the PR reaches `approved`. All of that logic lives in
the package; this repo only installs a pinned CLI version and invokes it.

The split — package in `rmartz/pr-lifecycle`, composite Action here — was chosen so
the Action can pin an exact CLI version in its own lockfile that Dependabot keeps
current; the rationale is recorded on
[rmartz/pr-lifecycle#6](https://github.com/rmartz/pr-lifecycle/issues/6).

## Status

**Scaffold.** The repo infrastructure is in place; `action.yml` and the CLI
dependency are not. They land once `@rmartz/pr-lifecycle` publishes its first
release. Until then, no consumer should reference this action.

## The contract it will build against

The CLI contract is **proposed** on
[rmartz/pr-lifecycle#6](https://github.com/rmartz/pr-lifecycle/issues/6) and is not
final until that issue lands; #6 is the source of truth, and this summary only says
what the Action depends on:

- **Invocation:** `ai-pr-lifecycle reconcile --repo <owner/repo> --pr <n>` plus
  optional policy flags, run by absolute path from the Action's own
  `node_modules/.bin` (as `bot-automerge-action` does).
- **Tokens via env:** a read/label token, and an optional real-actor token for
  arming so a merged PR re-triggers the consumer's `on: push` workflows.
- **Exit codes:** `0` reconciled (including a no-op), `1` GitHub/API failure, `2`
  usage error.
- **`--json` output:** one versioned JSON object on stdout carrying a
  `schemaVersion`. The Action will expose its fields as step outputs and fail loudly
  on an unknown `schemaVersion`.

The CLI owns every decision, including bot eligibility and fork trust; the Action
never adds a path that bypasses the CLI's classification. The trusted-authors
allowlist is a security requirement and never defaults to "trust anyone".
