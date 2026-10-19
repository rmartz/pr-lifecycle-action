---
type: Guidance
title: Consuming the action
description: How a repo calls pr-lifecycle-action — the caller workflow, its triggers and permissions, the inputs and outputs, the real-actor token, an App token for github-token with its self-trigger guard, and the prerequisites before arming auto-merge.
tags: [action, consuming, inputs, outputs, permissions, triggers]
---

# Consuming the action

A consuming repo adds one caller workflow. On every relevant event the action runs
`pr-lifecycle reconcile` for the PR(s) the event is about, converging the PR's
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
      # A bot review request added (or removed by hand) after a run's settle
      # wait moves the PR into (or out of) awaiting-bot-review.
      - review_requested
      - review_request_removed
  pull_request_review:
    types: [submitted, dismissed, edited]
  # CI completion. check_suite covers CI from third-party apps; it never fires for
  # suites GitHub Actions creates, so workflow_run covers Actions CI. List every
  # Actions workflow behind a required check, including a hold check such as
  # pr-policy: the CI gate ignores a hold's pending but counts its failure, so
  # its failing-to-passing transition needs a re-reconcile to clear `ci failing`.
  check_suite:
    types: [completed]
  workflow_run:
    workflows: [CI, pr-policy]
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
  actions: write # optional: report a transient failure as a cancelled run

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
      # Mint a short-lived GitHub App installation token for the `token` input
      # (see "The real-actor token" below). Store the App's Client ID and private
      # key as both Actions and Dependabot secrets.
      - uses: actions/create-github-app-token@<sha> # vX.Y.Z
        id: app-token
        with:
          client-id: ${{ secrets.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
      - uses: rmartz/pr-lifecycle-action@<sha> # vX.Y.Z
        with:
          token: ${{ steps.app-token.outputs.token }}
```

Pin the action by full commit SHA and let Dependabot's `github-actions` ecosystem
bump it; that is how new reconciler logic reaches you (see the
[distribution pipeline](design/distribution-pipeline.md)).

**Never add `actions/checkout` of the PR head to this job.** It runs on
`pull_request_target` with a write token. The action reads the PR over the API and
never checks out or runs PR code; approval carry-over fetches commits from the
base repository with `git` as data only.

## Transient failures

A rate limit, a GitHub outage, or a network error says nothing about the PR, so
the action reports it as a **cancelled** run rather than a failed one. A failed
run is kept for a real problem. Cancelling needs `actions: write`. Without it,
the job log gets a warning and the run succeeds. Either way, the next event
reconciles the PR. See the
[integration contract](design/integration-contract.md).

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

| Input                 | Default         | Meaning                                                                                                                                                                                                                                                                             |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr`                  | _(event)_       | PR number to reconcile; see above.                                                                                                                                                                                                                                                  |
| `github-token`        | `github.token`  | The CLI's `GITHUB_TOKEN`: every read and every label, review-request, and comment write.                                                                                                                                                                                            |
| `token`               | _(empty)_       | Real-actor token, exported as `PR_LIFECYCLE_TOKEN`, used **only** to arm, merge, and update branches. See [the token](#the-real-actor-token).                                                                                                                                       |
| `arm-auto-merge`      | `false`         | Arm, merge, or disarm auto-merge from the lifecycle state (`--arm-auto-merge`).                                                                                                                                                                                                     |
| `auto-update`         | `false`         | Bring an approved PR that merge-safety labels `update required` up to date with its base; a Dependabot PR is never updated, so a person or Dependabot rebases it ([why](https://github.com/rmartz/pr-lifecycle/blob/main/docs/github-edge-layer.md#auto-update)) (`--auto-update`). |
| `trusted-authors`     | _(empty)_       | Comma-separated logins to narrow trust to (`--trusted-authors`). Empty keeps the CLI policy: verdicts from write-access users, never bots.                                                                                                                                          |
| `skip-copilot-review` | `false`         | **Deprecated.** Don't wait for requested bot reviewers (`--skip-copilot-review`). The CLI now waits only while a bot review request is pending, so drop it.                                                                                                                         |
| `hold-checks`         | _(CLI default)_ | Required checks whose _pending_ is a human hold (`--hold-checks`; the CLI defaults to `pr-policy`). A failure still counts.                                                                                                                                                         |
| `ignore-checks`       | _(CLI default)_ | Required checks the CI gate never counts (`--ignore-checks`; the CLI defaults to `merge-safety`).                                                                                                                                                                                   |
| `token-advisory`      | `true`          | Post a one-time advisory comment when an arm or merge is skipped for want of `token`; `false` passes `--no-token-advisory`.                                                                                                                                                         |
| `dry-run`             | `false`         | Gather and plan, but write nothing (`--dry-run`).                                                                                                                                                                                                                                   |
| `node-version`        | `22`            | Node.js version to run the CLI under.                                                                                                                                                                                                                                               |

Boolean inputs must be exactly `true` or `false`; anything else fails the run. The
list inputs are passed only when non-empty, so an empty value keeps the CLI
default. There is deliberately no way to make `trusted-authors` trust everyone.

## Outputs

| Output               | Value                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `results`            | JSON array of the CLI's result for every PR reconciled (`[]` when none).                                                  |
| `result`             | The full result object as compact JSON.                                                                                   |
| `schema-version`     | Always `1`: the action fails on any other `schemaVersion`.                                                                |
| `state`              | The lifecycle state (e.g. `approved`, `awaiting-ci`, `awaiting-bot-review`). Treat values you don't know as non-terminal. |
| `add-labels`         | JSON array of labels added.                                                                                               |
| `remove-labels`      | JSON array of labels removed.                                                                                             |
| `auto-merge`         | `arm`, `merge`, `disarm`, or `none`.                                                                                      |
| `auto-merge-skipped` | JSON `{ "action": "arm" \| "merge", "reason": "token-missing" }`, or empty.                                               |
| `bot-eligible`       | `true` or `false`.                                                                                                        |
| `bot-eligibility`    | JSON `{ eligible, reason, prType, updateType }`.                                                                          |
| `carry-over`         | JSON `{ cleanAncestors, stoppedBecause }` for approval carry-over, or empty when it didn't run.                           |
| `update`             | The branch update performed: `update-branch` or `none`.                                                                   |
| `update-skipped`     | JSON `{ "action": "update-branch", "reason": "token-missing" }`, or empty.                                                |

Every output but `results` describes a single PR, so it is set only when exactly
one PR was reconciled. The field meanings are the CLI's; see its
[reference](https://github.com/rmartz/pr-lifecycle/blob/main/docs/cli.md#output).

## The real-actor token

A merge made with `GITHUB_TOKEN` — including one GitHub performs because
`GITHUB_TOKEN` armed auto-merge — triggers no `on: push` workflows, so your release
pipeline would never run. The CLI therefore arms, merges, and updates branches only
with the `token` input, and never falls back to `github-token`:

- **Recommended: a GitHub App installation token.** Create a GitHub App with
  **Contents: read and write** and **Pull requests: read and write**, install it
  on the repository, and mint a short-lived installation token each run with
  [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token),
  passing `steps.app-token.outputs.token` as `token` (see [the caller](#the-caller)).
  App-authored merges still trigger `on: push` workflows, the App draws on its
  own rate-limit pool, and merges are attributed to the App's bot account.
- **Still supported: a fine-grained PAT** with the same two permissions, passed
  as `token: ${{ secrets.PR_LIFECYCLE_TOKEN }}`. GitHub rate-limits per user
  across all of a user's tokens, so a PAT shares its owner's pool with
  everything else they run (another automation can exhaust it and fail this
  job), and every arm, merge, and branch update is attributed to that user.
- **Where to store the credentials:** as **Actions** secrets (the App's Client ID
  and private key, or the PAT), and also as **Dependabot** secrets if bot PRs
  should auto-merge — a run Dependabot triggers sees only Dependabot secrets.
- **When it's missing:** the run still succeeds and labels converge, but the arm,
  merge, or branch update is skipped. The job log shows a warning,
  `auto-merge-skipped` or `update-skipped` is set, and the CLI posts one advisory
  comment on the PR (unless `token-advisory: false`).

Because the token only arms, merges, and updates branches, the workflow `GITHUB_TOKEN` never needs
`contents: write`.

## An App token for `github-token`

By default every read and every label write uses the workflow's `GITHUB_TOKEN`,
so labels show as `github-actions[bot]`. Passing an App installation token as
`github-token` as well attributes those writes to the App's bot account and moves
the reads onto the App's rate-limit pool. Mint it with the permissions the caller
would otherwise grant `GITHUB_TOKEN`, and set `permissions: {}`:

```yaml
permissions: {}

jobs:
  reconcile:
    if: >-
      (github.event_name != 'pull_request_review' ||
      github.event.pull_request.head.repo.full_name == github.repository) &&
      !(github.event_name == 'pull_request_target' &&
      github.event.sender.login == '<app-slug>[bot]' &&
      contains(fromJSON('["labeled", "unlabeled", "review_requested", "review_request_removed"]'),
      github.event.action))
    # ...runs-on, timeout-minutes, concurrency as in the caller above
    steps:
      - uses: actions/create-github-app-token@<sha> # vX.Y.Z
        id: app-token
        with:
          client-id: ${{ secrets.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          permission-pull-requests: write
          permission-contents: read # use write if the same token is also `token`
          permission-checks: read
          permission-statuses: read
          permission-actions: write
      - uses: rmartz/pr-lifecycle-action@<sha> # vX.Y.Z
        with:
          github-token: ${{ steps.app-token.outputs.token }}
```

**Guard against self-triggering.** Events caused by `GITHUB_TOKEN` trigger no
workflows, but App-authored events do: each label or review request the action
writes fires a fresh `pull_request_target` run, which cancels the in-flight
writer through the concurrency group and then no-ops. The extended `if:` above
skips the `labeled`, `unlabeled`, `review_requested`, and
`review_request_removed` events the App itself sends. Keep the exclusion to the
App's own login, so a label from a person or another workflow still
re-reconciles. The App needs the same secrets setup as the
[real-actor token](#the-real-actor-token), including Dependabot secrets, since
here even labelling fails without it.

## Before you arm auto-merge

Start with labelling only (`arm-auto-merge` left `false`). Before turning arming
on:

- **Required checks must be in place.** Auto-merge lands the moment the branch
  ruleset's required checks pass; with no required checks it merges immediately.
- **Use a 7.0.0+ CLI (any current action release).** From CLI 7.0.0
  ([rmartz/pr-lifecycle#41](https://github.com/rmartz/pr-lifecycle/pull/41)) a
  release-please PR is identified by its branch and a release-only diff; the
  `autorelease: pending` label no longer counts, so labelling alone can't route a
  PR into auto-approval.
- **Fork PRs** are never bot-eligible, but a fork PR _is_ armed once a trusted
  write-access user approves its current head — the same human approval as any
  PR.

A PR waits in `awaiting-bot-review` only while a bot reviewer's review request is
pending (CLI 8.0.0,
[rmartz/pr-lifecycle#43](https://github.com/rmartz/pr-lifecycle/pull/43)), so it no
longer hangs on Dependabot PRs, repos without Copilot, or an out-of-quota Copilot.
The state was named `awaiting-copilot` before 8.0.0; update anything that matches
on the old name.

**Leaving `awaiting-bot-review` after a Copilot review.** GitHub holds any
workflow run that Copilot's review triggers (`pull_request_review`) until a
maintainer approves it. If nobody does, GitHub later fails it without running a
job. Copilot's request is cleared without a `review_request_removed` event,
which only fires when someone removes a request by hand. So the PR moves on at
the next event that does run, usually its CI completing (`workflow_run` /
`check_suite`). Approving the held run moves it on at once. It's harmless,
since the run only recomputes labels. `review_requested` is not held, so a
request that lands late still moves the PR into `awaiting-bot-review` straight
away (verified in rmartz/pr-lifecycle#85).
