---
type: Guidance
title: Consuming the action
description: How a repo calls pr-lifecycle-action — the caller workflow, its triggers and permissions, the inputs and outputs, the real-actor token (created from a GitHub App, with a labels-only fallback), the uat setting and the pr-lifecycle/sign-off status, moving off pr-policy-action's skip-uat, an App token for github-token with its self-trigger guard, and the prerequisites before arming auto-merge.
tags: [action, consuming, inputs, outputs, permissions, triggers, uat, sign-off]
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
      # A person's sign-off label (`no UAT needed`, `UAT passed`, `CI change
      # approved`) is reconciled straight away; see "UAT and the sign-off status".
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
      - uses: rmartz/pr-lifecycle-action@<sha> # vX.Y.Z
        with:
          # The action creates its real-actor token from this GitHub App. Store
          # both as Actions and Dependabot secrets (see "The real-actor token").
          # Until they are set, the run reconciles labels only.
          app-client-id: ${{ secrets.PR_LIFECYCLE_CLIENT_ID }}
          app-private-key: ${{ secrets.PR_LIFECYCLE_PRIVATE_KEY }}
          uat: 'on' # `off` for a repo that skips UAT by choice
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
| `app-client-id`       | _(empty)_       | Client ID of the GitHub App the action creates its real-actor token from. See [the token](#the-real-actor-token).                                                                                                                                                                   |
| `app-private-key`     | _(empty)_       | That App's private key. See [the token](#the-real-actor-token).                                                                                                                                                                                                                     |
| `token`               | _(empty)_       | A real-actor token made elsewhere, exported as `PR_LIFECYCLE_TOKEN`, used **only** to arm, merge, update branches, and post the [sign-off status](#uat-and-the-sign-off-status). Passing it with an App input fails the run. See [the token](#the-real-actor-token).                |
| `uat`                 | `on`            | The repo's UAT setting, `on` or `off` (`--uat`). See [UAT and the sign-off status](#uat-and-the-sign-off-status).                                                                                                                                                                   |
| `arm-auto-merge`      | `false`         | Arm, merge, or disarm auto-merge from the lifecycle state (`--arm-auto-merge`).                                                                                                                                                                                                     |
| `auto-update`         | `false`         | Bring an approved PR that merge-safety labels `update required` up to date with its base; a Dependabot PR is never updated, so a person or Dependabot rebases it ([why](https://github.com/rmartz/pr-lifecycle/blob/main/docs/github-edge-layer.md#auto-update)) (`--auto-update`). |
| `trusted-authors`     | _(empty)_       | Comma-separated logins to narrow trust to (`--trusted-authors`). Empty keeps the CLI policy: verdicts from write-access users, never bots.                                                                                                                                          |
| `skip-copilot-review` | `false`         | **Deprecated.** Don't wait for requested bot reviewers (`--skip-copilot-review`). The CLI now waits only while a bot review request is pending, so drop it.                                                                                                                         |
| `hold-checks`         | _(CLI default)_ | Required checks whose _pending_ is a human hold (`--hold-checks`; the CLI defaults to `pr-policy`). A failure still counts.                                                                                                                                                         |
| `ignore-checks`       | _(CLI default)_ | Required checks the CI gate never counts (`--ignore-checks`; the CLI defaults to `merge-safety`).                                                                                                                                                                                   |
| `token-advisory`      | `true`          | Post a one-time advisory comment when an arm, merge, or the sign-off status is skipped for want of a real-actor token; `false` passes `--no-token-advisory`. The job log and `token-source` say which case it was.                                                                  |
| `dry-run`             | `false`         | Gather and plan, but write nothing (`--dry-run`).                                                                                                                                                                                                                                   |
| `node-version`        | `22`            | Node.js version to run the CLI under.                                                                                                                                                                                                                                               |

Boolean inputs must be exactly `true` or `false`, and `uat` exactly `on` or `off`;
anything else fails the run. Quote the `uat` value (`uat: 'off'`): a YAML 1.1
parser reads a bare `off` as `false`. The list inputs are passed only when
non-empty, so an empty value keeps the CLI default. There is deliberately no way to make `trusted-authors` trust everyone.

## Outputs

| Output                    | Value                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `token-source`            | Where the real-actor token came from: `token`, `app`, `app-failed`, `app-incomplete`, or `none`. Set on every run.        |
| `results`                 | JSON array of the CLI's result for every PR reconciled (`[]` when none).                                                  |
| `result`                  | The full result object as compact JSON.                                                                                   |
| `schema-version`          | Always `1`: the action fails on any other `schemaVersion`.                                                                |
| `state`                   | The lifecycle state (e.g. `approved`, `awaiting-ci`, `awaiting-bot-review`). Treat values you don't know as non-terminal. |
| `add-labels`              | JSON array of labels added.                                                                                               |
| `remove-labels`           | JSON array of labels removed.                                                                                             |
| `auto-merge`              | `arm`, `merge`, `disarm`, or `none`.                                                                                      |
| `auto-merge-skipped`      | JSON `{ "action": "arm" \| "merge", "reason": "token-missing" }`, or empty.                                               |
| `bot-eligible`            | `true` or `false`.                                                                                                        |
| `bot-eligibility`         | JSON `{ eligible, reason, prType, updateType }`.                                                                          |
| `carry-over`              | JSON `{ cleanAncestors, stoppedBecause }` for approval carry-over, or empty when it didn't run.                           |
| `update`                  | The branch update performed: `update-branch` or `none`.                                                                   |
| `update-skipped`          | JSON `{ "action": "update-branch", "reason": "token-missing" }`, or empty.                                                |
| `uat`                     | JSON `{ outcome, label }` for the PR's one UAT label, or empty for a closed PR. A PR needing CI sign-off reports `ci`.    |
| `sign-off`                | JSON `{ requirement, reason, loosening, status, statusPosted }` for the sign-off status, or empty for a closed PR.        |
| `sign-off-status-skipped` | JSON `{ "reason": "token-missing" }`, or empty.                                                                           |

Every output but `results` and `token-source` describes a single PR, so it is set
only when exactly one PR was reconciled. The field meanings are the CLI's; see its
[reference](https://github.com/rmartz/pr-lifecycle/blob/main/docs/cli.md#output).

## The real-actor token

A merge made with `GITHUB_TOKEN` — including one GitHub performs because
`GITHUB_TOKEN` armed auto-merge — triggers no `on: push` workflows, so your release
pipeline would never run, and a status created with `GITHUB_TOKEN` triggers no
workflow, so pr-policy would never re-run. The CLI therefore arms, merges, updates
branches, and posts the [sign-off status](#uat-and-the-sign-off-status) only with
a real-actor token (the CLI's `PR_LIFECYCLE_TOKEN`), and never falls back to
`github-token`.

### A GitHub App (recommended)

Pass the App's credentials as `app-client-id` and `app-private-key`. The action
creates an installation token for **this repository only** with
[`actions/create-github-app-token`](https://github.com/actions/create-github-app-token)
and uses it as the real-actor token. Drop any token-creation step of your own from
the caller. Leave `github-token` alone: it stays the workflow token unless you set
it.

- **The App's repository permissions:**
  - **Contents**, **Pull requests**, **Issues**, **Commit statuses**, and
    **Workflows**: read and write;
  - **Checks**: read;
  - **Metadata**: read (GitHub grants it to every App).

  The action asks for exactly these, so an App missing one can't create the
  token, and the run falls back as below. Workflows write is what lets a merge or
  branch update go through on a PR that changes `.github/workflows/`.

- **pr-policy must name the App.** pr-policy trusts a `pr-lifecycle/sign-off`
  status from a person with write access, or from an App its caller names. Add
  the App's bot login (`<app-slug>[bot]`) to pr-policy-action's
  `sign-off-status-creators` input; otherwise pr-policy holds every PR.
- **Install the App** on every repository that runs this action.
- **Store both credentials as Actions secrets and as Dependabot secrets.** A run
  Dependabot triggers sees only Dependabot secrets, and its PRs need the sign-off
  status too.
- The App has its own rate-limit pool, and merges and statuses are attributed to
  its bot account.

### When there's no token: labels only

A missing or unusable App never fails the job. The run reconciles labels as
usual, and the CLI skips arming, merging, branch updates, and the sign-off status.
The `token-source` output and the job log say which case it was:

| `token-source`   | When                                                                     | Job log                                            |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| `app`            | The App token was created and used.                                      | —                                                  |
| `token`          | The caller passed `token`.                                               | —                                                  |
| `none`           | No token or App input is set (secrets not set yet, or a Dependabot run). | the per-skip warnings                              |
| `app-incomplete` | Only one of `app-client-id` and `app-private-key` is set.                | a warning naming the missing input, then the skips |
| `app-failed`     | Creating the token failed: the App isn't installed here, or a bad key.   | the token step's error, a warning, then the skips  |

The CLI also posts its one-time advisory comment on the PR (unless
`token-advisory: false`), and sets `auto-merge-skipped`, `update-skipped`, or
`sign-off-status-skipped`. With no sign-off status, pr-policy fails closed and
holds the PR. So a caller can ship before its secrets exist, and starts arming and
posting the status on the first run after they are set.

### A token made elsewhere: `token`

`token` takes a real-actor token from somewhere else, such as a person's
fine-grained PAT (`${{ secrets.PR_LIFECYCLE_TOKEN }}`) with Contents, Pull
requests, and Commit statuses read and write. pr-policy trusts a write-access
person's status without being told. A PAT shares its owner's rate-limit pool, and
every write is attributed to them.

**Pass `token` or the App inputs, never both.** Which identity should arm and
merge would be ambiguous, so the run fails at its first step with an error, even
when only one App input is set alongside `token`.

Because only the real-actor token makes these writes, the workflow `GITHUB_TOKEN`
never needs `contents: write` or `statuses: write`.

## UAT and the sign-off status

pr-lifecycle decides which human sign-off each PR head needs: none, the CI
sign-off (`CI change approved`), or UAT. It posts that decision as the
`pr-lifecycle/sign-off` commit status, which pr-policy gates on. The status is
the machine contract between the two; the labels are for people. Its grammar, the
classification rules, and when it is posted are in pr-lifecycle's
[sign-off status](https://github.com/rmartz/pr-lifecycle/blob/main/docs/sign-off-status.md)
reference.

- **`uat: 'on'`** (the default) keeps exactly one of `no UAT needed`,
  `UAT pending`, `UAT ready`, or `UAT passed` on each open PR. A PR that needs
  UAT shows `UAT pending` until a trusted person signs it off. UAT is only for
  the product's user-facing behavior, and CI and other tooling never is. A PR
  that can't be user-facing gets `no UAT needed`: a `docs`/`test`/`refactor`
  title, or one whose every path is statically trivial or CI/tooling (workflows
  other than a shipped `workflow_call`-only one, `.github/actions/**`, tooling
  config, top-level `scripts/**`). So does a `ci:` PR that needs the CI sign-off
  (`CI change approved`) instead of UAT. A CI loosening still needs that
  sign-off whatever the title. See pr-lifecycle's
  [UAT labels](https://github.com/rmartz/pr-lifecycle/blob/main/docs/uat.md).
- **`uat: 'off'`** labels every PR `no UAT needed`. The status says
  `requirement=none`, except for a `ci:` PR that needs the CI sign-off
  (`requirement=ci`).
- **Set it in the caller on the base branch.** The caller runs on
  `pull_request_target`, so GitHub reads the workflow, and with it the `uat`
  value, from the base branch: a PR can't turn UAT off for itself.
- **Keep `labeled` and `unlabeled` in the triggers.** A person's sign-off label
  (`no UAT needed`, `UAT passed`, `CI change approved`) changes the status, so
  it is reconciled as soon as it's applied, not at the next push or CI run.
- **A real-actor token is required for the gate to pass.** See
  [the real-actor token](#the-real-actor-token).

### Moving off pr-policy-action's `skip-uat`

pr-lifecycle now owns the UAT setting, and pr-policy-action's `skip-uat` input is
being retired. In a repo whose pr-policy caller sets `skip-uat: true`:

1. Pass `uat: 'off'` to this action in `.github/workflows/pr-lifecycle.yml`, with
   a [real-actor token](#the-real-actor-token) that can post the status: the App
   inputs (and the App named in pr-policy's `sign-off-status-creators`), or a PAT.
2. Once a run has posted `pr-lifecycle/sign-off` on open PRs, remove `skip-uat`
   from `.github/workflows/pr-policy.yml`.

A repo that never set `skip-uat` keeps the default, `uat: 'on'`.

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
          permission-contents: read
          permission-checks: read
          permission-statuses: read
          permission-actions: write
      - uses: rmartz/pr-lifecycle-action@<sha> # vX.Y.Z
        with:
          github-token: ${{ steps.app-token.outputs.token }}
          app-client-id: ${{ secrets.PR_LIFECYCLE_CLIENT_ID }}
          app-private-key: ${{ secrets.PR_LIFECYCLE_PRIVATE_KEY }}
```

**Guard against self-triggering.** Events caused by `GITHUB_TOKEN` trigger no
workflows, but App-authored events do: each label or review request the action
writes fires a fresh `pull_request_target` run, which cancels the in-flight
writer through the concurrency group and then no-ops. The extended `if:` above
skips the `labeled`, `unlabeled`, `review_requested`, and
`review_request_removed` events the App itself sends. Keep the exclusion to the
App's own login, so a label from a person or another workflow still
re-reconciles. The App's credentials need the same secrets setup as the
[real-actor token](#the-real-actor-token), including Dependabot secrets. Unlike
the real-actor token, this step has no fallback: if it fails, the job fails,
since without `github-token` even labelling can't run.

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
