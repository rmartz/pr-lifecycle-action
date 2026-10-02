---
type: Design
title: The integration contract
description: What the action relies on from the pr-lifecycle CLI, what it adds around it (PR resolution, output mapping, schemaVersion guard), what it deliberately never does, and why it ships as a composite action only.
tags: [design, contract, cli, security]
---

# The integration contract

The action is a thin wrapper around `pr-lifecycle reconcile` from
[`@rmartz/pr-lifecycle`](https://github.com/rmartz/pr-lifecycle), pinned to an
exact version in [`package.json`](../../package.json) and the lockfile. The CLI's
contract — flags, environment, exit codes, and the versioned `--json` shape — is
defined in its
[`docs/cli.md`](https://github.com/rmartz/pr-lifecycle/blob/main/docs/cli.md) and
agreed on [rmartz/pr-lifecycle#6](https://github.com/rmartz/pr-lifecycle/issues/6).
How a repo calls the action is in [Consuming the action](../consuming.md).

## What the action does

[`action.yml`](../../action.yml) has three steps:

1. **Set up Node** at `node-version`.
2. **Install the pinned CLI** with `npm ci --omit=dev --ignore-scripts` in
   `$GITHUB_ACTION_PATH` — the action's own directory, never the consumer
   workspace. The action's [`.npmrc`](../../.npmrc) pins the `@rmartz` scope to
   npmjs, where the package is public, so the install needs no token.
3. **Reconcile** with [`scripts/reconcile.sh`](../../scripts/reconcile.sh), which:
   - maps each input 1:1 onto a CLI flag, rejecting a boolean that isn't `true`
     or `false`, and passing a list input only when it is non-empty;
   - exports `github-token` as `GITHUB_TOKEN` and `token` as `PR_LIFECYCLE_TOKEN`
     (`GITHUB_API_URL` comes from the runner);
   - resolves the PR(s) when `pr` is empty (below);
   - runs the CLI by absolute path from `node_modules/.bin` with `--json`, once per
     PR, and fails the step if any run exits non-zero, except `75`;
   - **reports a transient failure as a cancelled run.** CLI exit `75` means a
     rate limit, a GitHub outage, or a network error, not a problem with the PR,
     and a failed run should mean the PR needs a fix. A step can't mark its own
     job cancelled, so the script asks the API to cancel the run (`POST
…/actions/runs/{id}/cancel`, which needs `actions: write`) and waits for the
     runner to stop the job. If the job lacks the permission, or the cancel
     doesn't land within two minutes, it leaves a warning and the step succeeds:
     the next event reconciles the PR anyway. A real failure on another PR in
     the same run still fails the step, without cancelling;
   - **fails loudly on any `schemaVersion` other than `1`**, rather than guessing at
     a shape it doesn't know;
   - writes the fields as step outputs, and surfaces `carryOver.stoppedBecause`,
     `autoMergeSkipped`, and `updateSkipped` in the job log.

The `state` output passes the CLI's value through unchanged, so a CLI rename
reaches consumers as-is: CLI 8.0.0 renamed `awaiting-copilot` to
`awaiting-bot-review` without a `schemaVersion` bump, which is why that pin bump
was a major action release (see [versioning](versioning.md)). The deprecated
`skip-copilot-review` input still maps to `--skip-copilot-review`; `action.yml`'s
`deprecationMessage` warns callers that set it.

Its behaviour is pinned by hermetic tests in
[`test/reconcile.test.mjs`](../../test/reconcile.test.mjs), which run the script
against a stub CLI and a stub `gh`.

## PR resolution

Resolving which PR an event is about is plumbing, not a lifecycle decision, and
doing it in the action spares every caller a resolver job and matrix. With `pr`
empty, the script uses the `pull_request` payload, then a `workflow_dispatch` `pr`
input, then the `pull_requests` of a `check_suite` or `workflow_run` (keeping those
whose base is this repo). GitHub leaves that list empty for fork PRs, so an empty
list falls back to `GET /repos/{repo}/commits/{head_sha}/pulls`, keeping open PRs
into this repo. This is how CI completing on GitHub Actions — which never fires
`check_suite` — re-reconciles a PR
([#9](https://github.com/rmartz/pr-lifecycle-action/issues/9)).

## What the action never does

- **It never decides.** Lifecycle state, labels, bot eligibility, fork trust, and
  whether to arm or merge are the CLI's. There is no step that arms auto-merge
  itself, skips the CLI for a "known-safe" PR, or rejects forks on its own:
  unlike `bot-automerge-action`, which had no concept of a human verdict, the CLI
  already refuses bot eligibility to cross-repository PRs and arms a fork PR only
  on a trusted user's approval of its current head.
- **It never trusts anyone by default.** An empty `trusted-authors` omits the flag,
  leaving the CLI's policy — verdicts from write-access users, never bots — in
  place. The action offers no way to widen trust.
- **It never checks out or runs PR code**, which is what makes running on
  `pull_request_target` with a write token safe.
- **It never arms, merges, or updates a branch with `GITHUB_TOKEN`.** Only
  `token` reaches `PR_LIFECYCLE_TOKEN`.

## Composite action only

The action ships as a composite action, not also as a reusable workflow of the
kind `bot-automerge-action` offers. A reusable workflow could carry the triggers'
concurrency group and permissions itself, but it is a second shipped surface with
its own inputs and versioning, and with PR resolution inside the action the caller
is a single job with no resolver or matrix. Revisit once dogfooding on this repo
shows whether the caller's boilerplate is a real burden.
