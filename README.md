# pr-lifecycle-action

A **composite GitHub Action** that runs the
[`@rmartz/pr-lifecycle`](https://github.com/rmartz/pr-lifecycle) reconciler in a
consuming repo: on every relevant PR event it recomputes the PR's lifecycle labels
from its current facts and, when the PR reaches `approved`, arms GitHub-native
auto-merge. The consumer's branch ruleset (required checks) still decides when the
merge lands.

> **Status: early.** The action pins an exact `@rmartz/pr-lifecycle` version (see
> [`package.json`](package.json)), which Dependabot keeps current. See
> [Consuming the action](docs/consuming.md) for the caller workflow and the checks
> to make before turning on `arm-auto-merge`.

## Usage

```yaml
- uses: rmartz/pr-lifecycle-action@<sha> # vX.Y.Z
  with:
    token: ${{ secrets.PR_LIFECYCLE_TOKEN }} # real-actor PAT: arm, merge, sign-off status
    uat: 'on' # or off
```

The full caller (triggers, permissions, concurrency) and every input and output
are in [docs/consuming.md](docs/consuming.md).

## The sign-off status: the contract with pr-policy

pr-lifecycle decides which human sign-off each PR head needs (none, the CI
sign-off, or UAT) and posts it as the **`pr-lifecycle/sign-off`** commit status.
[pr-policy](https://github.com/rmartz/pr-policy) gates on that status, not on the
labels. Its grammar and rules are in pr-lifecycle's
[sign-off status](https://github.com/rmartz/pr-lifecycle/blob/main/docs/sign-off-status.md)
reference.

- **`token` must be a person's fine-grained PAT** with **Contents**, **Pull
  requests**, and **Commit statuses**, all read and write. pr-policy trusts the
  status only from a write-access `User`, so a GitHub App installation token,
  which reads as a bot, won't do. Without `token`, no status is posted and
  pr-policy holds every PR. `token-advisory` comments on the PR when that
  happens. See [the real-actor token](docs/consuming.md#the-real-actor-token).
- **`uat`** (`on` | `off`, default `on`) is the repo's UAT setting. The caller
  runs on `pull_request_target`, so it is read from the base branch.
- **Keep the `labeled` / `unlabeled` triggers**, so a person's sign-off label
  is reconciled straight away.
- **Migrating from pr-policy-action's `skip-uat: true`:** set `uat: 'off'` here,
  then drop `skip-uat` from the pr-policy caller once the status is being posted.
  See [the migration](docs/consuming.md#moving-off-pr-policy-actions-skip-uat).

## How versions flow

The action pins an exact `@rmartz/pr-lifecycle` version in its own lockfile.
Dependabot bumps that pin → semantic-release cuts a new action release → each
consumer's Dependabot bumps its SHA pin of this action. No consumer edits a version
by hand. See [the distribution pipeline](docs/design/distribution-pipeline.md).

## Documentation

See [docs/index.md](docs/index.md). Contributors (human or agent) should start with
[AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
