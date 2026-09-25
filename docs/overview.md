---
type: Reference
title: What pr-lifecycle-action is
description: The composite Action that wraps the @rmartz/pr-lifecycle CLI, its status, and the CLI version it pins.
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

**Early.** [`action.yml`](../action.yml) pins `@rmartz/pr-lifecycle` **5.0.0**, the
latest version on npmjs. Use it for labelling now. Hold off on `arm-auto-merge` until
[rmartz/pr-lifecycle#40](https://github.com/rmartz/pr-lifecycle/issues/40) ships
(see [Before you arm auto-merge](consuming.md#before-you-arm-auto-merge)). CLI
features newer than 5.0.0, such as `--auto-update`, arrive as Dependabot bumps of
the pin, each followed by the input that exposes it.

## How it fits together

- [Consuming the action](consuming.md) — the caller workflow, triggers,
  permissions, inputs, outputs, and the real-actor token.
- [The integration contract](design/integration-contract.md) — what the action
  relies on from the CLI (flags, token env vars, exit codes, the versioned `--json`
  output), what it adds around it, and what it never does.

The CLI owns every decision, including bot eligibility and fork trust; the Action
never adds a path that bypasses the CLI's classification. The trusted-authors
allowlist is a security requirement and never defaults to "trust anyone".
