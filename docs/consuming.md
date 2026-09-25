---
type: Guidance
title: Consuming the action
description: How a repo calls pr-lifecycle-action — the caller workflow, its triggers and permissions, the inputs and outputs, the real-actor token, and the prerequisites before arming auto-merge.
tags: [action, consuming, inputs, outputs, permissions, triggers]
---

# Consuming the action

A consuming repo adds one caller workflow. On every relevant event the action runs
`ai-pr-lifecycle reconcile` for the PR(s) the event is about, converging the PR's
lifecycle labels and, when enabled, GitHub-native auto-merge. The CLI makes every
decision; see the [integration contract](design/integration-contract.md).

## The caller

```yaml
# .github/workflows/pr-lifecycle.yml
name: pr-lifecycle

on:
  pull_request_target:
    types:
      - opened
      - reopened
      - ready_for_review
      - converted_to_draft
      - synchronize
      - edited
      - labeled
      - unlabeled
  pull_request_review:
    types: [submitted, dismissed, edited]
  # CI completion. check_suite covers CI from third-party apps; it never fires for
  # suites GitHub Actions creates, so workflow_run covers Actions CI. List your own
  # CI workflow names.
  check_suite:
    types: [completed]
  workflow_run:
    workflows: [CI]
    types: [completed]
  workflow_dispatch:
    inputs:
      pr:
        description: PR number to reconcile
        required: true

permissions:
  pull-requests: write # labels, review requests, advisory comment, disarming
  contents: read # branch rules, base head, commits for approval carry-over
  checks: read # the CI gate
  statuses: read # the CI gate

jobs:
  reconcile:
    # A review on a fork PR runs with a read-only token and no secrets, so it
    # cannot write labels; skip it rather than fail. The fork PR is reconciled on
    # its next pull_request_target event, or on demand via workflow_dispatch.
    if: >-
      github.event_name != 'pull_request_review' ||
      github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 5
    # One run per PR at a time; a newer event supersedes an in-flight run, since
    # every run recomputes the PR from its current facts. CI-completion events are
    # keyed by head SHA, as the PR number is only known inside the action.
    concurrency:
      group: >-
        pr-lifecycle-${{ github.event.pull_request.number || inputs.pr ||
        github.event.workflow_run.head_sha || github.event.check_suite.head_sha }}
      cancel-in-progress: true
    steps:
      - uses: rmartz/pr-lifecycle-action@<sha> # vX.Y.Z
        with:
          token: ${{ secrets.PR_LIFECYCLE_TOKEN }}
          skip-copilot-review: true
```

Pin the action by full commit SHA and let Dependabot's `github-actions` ecosystem
bump it; that is how new reconciler logic reaches you (see the
[distribution pipeline](design/distribution-pipeline.md)).

**Never add `actions/checkout` of the PR head to this job.** It runs on
`pull_request_target` with a write token. The action reads the PR over the API and
never checks out or runs PR code; approval carry-over fetches commits from the
base repository with `git` as data only.

## Which PR it reconciles

Leave `pr` empty and the action resolves it from the event:

| Event                                        | PR(s) reconciled                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pull_request_target`, `pull_request_review` | The event's PR.                                                                                                                                                                              |
| `workflow_dispatch`                          | The `pr` input of the dispatch.                                                                                                                                                              |
| `check_suite`, `workflow_run`                | Each PR in the payload's `pull_requests` into this repo. GitHub leaves that list empty for fork PRs, so an empty list falls back to the open PRs into this repo whose head is the run's SHA. |

An event that names no open PR (e.g. CI on a push to `main`) succeeds without
calling the CLI. Set `pr` explicitly only to override this.

## Inputs

| Input                 | Default         | Meaning                                                                                                                                    |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pr`                  | _(event)_       | PR number to reconcile; see above.                                                                                                         |
| `github-token`        | `github.token`  | The CLI's `GITHUB_TOKEN`: every read and every label, review-request, and comment write.                                                   |
| `token`               | _(empty)_       | Real-actor token, exported as `PR_LIFECYCLE_TOKEN`, used **only** to arm and merge. See [the token](#the-real-actor-token).                |
| `arm-auto-merge`      | `false`         | Arm, merge, or disarm auto-merge from the lifecycle state (`--arm-auto-merge`).                                                            |
| `trusted-authors`     | _(empty)_       | Comma-separated logins to narrow trust to (`--trusted-authors`). Empty keeps the CLI policy: verdicts from write-access users, never bots. |
| `skip-copilot-review` | `false`         | Don't wait for a Copilot review (`--skip-copilot-review`).                                                                                 |
| `hold-checks`         | _(CLI default)_ | Required checks whose _pending_ is a human hold (`--hold-checks`; the CLI defaults to `pr-policy`).                                        |
| `ignore-checks`       | _(CLI default)_ | Required checks the CI gate never counts (`--ignore-checks`; the CLI defaults to `merge-safety`).                                          |
| `token-advisory`      | `true`          | Post a one-time advisory comment when an arm or merge is skipped for want of `token`; `false` passes `--no-token-advisory`.                |
| `dry-run`             | `false`         | Gather and plan, but write nothing (`--dry-run`).                                                                                          |
| `node-version`        | `22`            | Node.js version to run the CLI under.                                                                                                      |

Boolean inputs must be exactly `true` or `false`; anything else fails the run. The
list inputs are passed only when non-empty, so an empty value keeps the CLI
default. There is deliberately no way to make `trusted-authors` trust everyone.

## Outputs

| Output               | Value                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `results`            | JSON array of the CLI's result for every PR reconciled (`[]` when none).                           |
| `result`             | The full result object as compact JSON.                                                            |
| `schema-version`     | Always `1`: the action fails on any other `schemaVersion`.                                         |
| `state`              | The lifecycle state (e.g. `approved`, `awaiting-ci`). Treat values you don't know as non-terminal. |
| `add-labels`         | JSON array of labels added.                                                                        |
| `remove-labels`      | JSON array of labels removed.                                                                      |
| `auto-merge`         | `arm`, `merge`, `disarm`, or `none`.                                                               |
| `auto-merge-skipped` | JSON `{ "action": "arm" \| "merge", "reason": "token-missing" }`, or empty.                        |
| `bot-eligible`       | `true` or `false`.                                                                                 |
| `bot-eligibility`    | JSON `{ eligible, reason, prType, updateType }`.                                                   |
| `carry-over`         | JSON `{ cleanAncestors, stoppedBecause }` for approval carry-over, or empty when it didn't run.    |

Every output but `results` describes a single PR, so it is set only when exactly
one PR was reconciled. The field meanings are the CLI's; see its
[reference](https://github.com/rmartz/pr-lifecycle/blob/main/docs/cli.md#output).

## The real-actor token

A merge made with `GITHUB_TOKEN` — including one GitHub performs because
`GITHUB_TOKEN` armed auto-merge — triggers no `on: push` workflows, so your release
pipeline would never run. The CLI therefore arms and merges only with the `token`
input, and never falls back to `github-token`:

- **What it is:** a fine-grained PAT with **Contents: read and write** and **Pull
  requests: read and write** on the repository (a GitHub App installation token
  works too).
- **Where to store it:** as the `PR_LIFECYCLE_TOKEN` **Actions** secret, and also as
  a **Dependabot** secret if bot PRs should auto-merge — a run Dependabot triggers
  sees only Dependabot secrets.
- **When it's missing:** the run still succeeds and labels converge, but the arm or
  merge is skipped. The job log shows a warning, `auto-merge-skipped` is set, and
  the CLI posts one advisory comment on the PR (unless `token-advisory: false`).

Because the token only arms and merges, the workflow `GITHUB_TOKEN` never needs
`contents: write`.

## Before you arm auto-merge

Start with labelling only (`arm-auto-merge` left `false`). Before turning arming
on:

- **Required checks must be in place.** Auto-merge lands the moment the branch
  ruleset's required checks pass; with no required checks it merges immediately.
- **Wait for [rmartz/pr-lifecycle#40](https://github.com/rmartz/pr-lifecycle/issues/40).**
  In CLI 5.0.0 the `autorelease: pending` label alone marks a same-repo PR as a
  release-please PR, so a user who can only label could route a write user's
  unreviewed PR into auto-approval. Labelling mode is unaffected.
- **Fork PRs** are never bot-eligible, but a fork PR _is_ armed once a trusted
  write-access user approves its current head — the same human approval as any
  PR.

`skip-copilot-review: true` is recommended for now: Copilot's out-of-quota notice
no longer reaches the API
([rmartz/pr-lifecycle#36](https://github.com/rmartz/pr-lifecycle/issues/36)), so
without it a PR with no verdict can sit in `awaiting-copilot`.
