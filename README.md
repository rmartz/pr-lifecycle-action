# pr-lifecycle-action

A **composite GitHub Action** that runs the
[`@rmartz/pr-lifecycle`](https://github.com/rmartz/pr-lifecycle) reconciler in a
consuming repo: on every relevant PR event it recomputes the PR's lifecycle labels
from its current facts and, when the PR reaches `approved`, arms GitHub-native
auto-merge. The consumer's branch ruleset (required checks) still decides when the
merge lands.

> **Status: early.** The action pins `@rmartz/pr-lifecycle` 5.0.0. Use it for
> labelling now; hold off on `arm-auto-merge` until
> [rmartz/pr-lifecycle#40](https://github.com/rmartz/pr-lifecycle/issues/40) ships.
> See [Consuming the action](docs/consuming.md) for the caller workflow.

## Usage

```yaml
- uses: rmartz/pr-lifecycle-action@<sha> # vX.Y.Z
  with:
    token: ${{ secrets.PR_LIFECYCLE_TOKEN }} # real-actor token, used only to arm/merge
```

The full caller — triggers, permissions, concurrency — plus every input and output
is in [docs/consuming.md](docs/consuming.md).

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
