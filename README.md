# pr-lifecycle-action

A **composite GitHub Action** that runs the
[`@rmartz/pr-lifecycle`](https://github.com/rmartz/pr-lifecycle) reconciler in a
consuming repo: on every relevant PR event it recomputes the PR's lifecycle labels
from its current facts and, when the PR reaches `approved`, arms GitHub-native
auto-merge. The consumer's branch ruleset (required checks) still decides when the
merge lands.

> **Status: scaffold.** The repo infrastructure (CI, release pipeline, Dependabot,
> docs) is in place. `action.yml` lands once `@rmartz/pr-lifecycle` publishes its
> first release — tracked by
> [rmartz/pr-lifecycle#6](https://github.com/rmartz/pr-lifecycle/issues/6). Do not
> reference this action from a consumer yet.

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
