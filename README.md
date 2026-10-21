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
    app-client-id: ${{ secrets.PR_LIFECYCLE_CLIENT_ID }}
    app-private-key: ${{ secrets.PR_LIFECYCLE_PRIVATE_KEY }}
    uat: 'on' # or off
```

The full caller (triggers, permissions, concurrency) and every input and output
are in [docs/consuming.md](docs/consuming.md).

## The real-actor token

Arming, merging, branch updates, and the sign-off status need a real-actor token:
one made with the workflow's `GITHUB_TOKEN` triggers no workflows, so releases and
pr-policy would never run. The action creates it from a GitHub App:

- **Pass `app-client-id` and `app-private-key`.** The action creates an
  installation token for the current repository, so the caller needs no
  token-creation step of its own (drop the one it has). `github-token` is
  unchanged.
- **The App needs** Contents, Pull requests, Issues, Commit statuses, and
  Workflows read and write; Checks read; and Metadata read. It must be installed
  on the repository. Store both credentials as Actions and Dependabot secrets.
- **It falls back, and never fails the job.** If both inputs are empty (the
  secrets aren't set yet, or a Dependabot run without them), only one is set,
  or creating the token fails (the App isn't installed, or a bad key), the run
  reconciles labels only. Arming, merging, updates, and the status are skipped.
  The job log, the `token-source` output, and the one-time `token-advisory`
  comment say so. A caller can therefore merge before its secrets exist.
- **`token` takes a token made elsewhere** (a person's PAT, say) instead.
  Passing it together with an App input is a misconfiguration and fails the run.

See [the real-actor token](docs/consuming.md#the-real-actor-token).

## The sign-off status: the contract with pr-policy

pr-lifecycle decides which human sign-off each PR head needs (none, the CI
sign-off, or UAT) and posts it as the **`pr-lifecycle/sign-off`** commit status.
[pr-policy](https://github.com/rmartz/pr-policy) gates on that status, not on the
labels. Its grammar and rules are in pr-lifecycle's
[sign-off status](https://github.com/rmartz/pr-lifecycle/blob/main/docs/sign-off-status.md)
reference.

- **The status is posted with the real-actor token**, so pr-policy has to trust
  its creator. It trusts a write-access person, or an App its caller names: add
  the App's bot login (`<app-slug>[bot]`) to pr-policy-action's
  `sign-off-status-creators`. With no real-actor token, no status is posted and
  pr-policy holds every PR.
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
