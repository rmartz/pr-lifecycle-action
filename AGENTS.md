# Agent guide — pr-lifecycle-action

This repo is the **composite GitHub Action** that runs the
[`@rmartz/pr-lifecycle`](https://github.com/rmartz/pr-lifecycle) reconciler in a
consuming repo. It will hold the CLI as a pinned `package.json` dependency, wrap it
in `action.yml`, and re-release itself via semantic-release whenever Dependabot bumps
that pin — the chain that ships new reconciler logic to the fleet. It is modelled on
[`bot-automerge-action`](https://github.com/rmartz/bot-automerge-action) and
[`repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action). See
[README.md](README.md) and the [documentation](docs/index.md).

> **Status: scaffold.** Repo infrastructure only. `action.yml` and the CLI pin wait
> for the first published `@rmartz/pr-lifecycle` release
> ([rmartz/pr-lifecycle#6](https://github.com/rmartz/pr-lifecycle/issues/6)).

## Division of responsibility with `rmartz/pr-lifecycle`

- **The CLI owns every decision** — lifecycle state, labels, bot eligibility, fork
  trust, and whether to arm auto-merge. This action only installs the pinned CLI and
  invokes it. Never re-implement or short-circuit its classification here (e.g. a
  step that arms auto-merge itself, or skips the CLI for a "known-safe" PR).
- **The interface contract lives on
  [rmartz/pr-lifecycle#6](https://github.com/rmartz/pr-lifecycle/issues/6)** — the
  `ai-pr-lifecycle reconcile` flags, token env vars, exit codes, and the versioned
  `--json` output (`schemaVersion`). Raise any change you need there before building
  against it. Fail loudly on an unknown `schemaVersion` rather than guessing.
- **Do not invent fleet contracts** — check-run names, label names, or input names
  beyond what #6 defines are the package's to choose.
- **The trusted-authors allowlist is a security requirement**
  ([rmartz/ai-tools#306](https://github.com/rmartz/ai-tools/issues/306)): never give
  it a "trust anyone" default.

## Documentation — read it first, maintain it every task

- **Read first.** Before changing `action.yml`, a workflow, or a config, read the
  relevant [`docs/`](docs/index.md) page(s) and this file.
- **Extend, correct, and remove in the same PR.** If your change alters or
  contradicts anything a doc says, fix that doc in the same PR. An outdated doc is
  worse than none.
- **Docs follow OKF.** Pages under `docs/` use Open Knowledge Format frontmatter
  (`type` / `title` / `description` required) and stay reachable from
  [`docs/index.md`](docs/index.md) under the nested-index rule. The `okf`,
  `okf-index`, and `docs-links` checks enforce this in CI (the Repo Hygiene job).
  See [docs/okf-format.md](docs/okf-format.md).

## Repository conformance

This repo is held to the shared
[repository checklist](https://github.com/rmartz/ai/blob/main/docs/guidance/repository-checklist.md)
and **self-manages** its own config: fix conformance gaps directly here, in a PR.
The `repo-hygiene`, `merge-safety`, and `bot-automerge` callers are SHA-pinned and
bumped by Dependabot; CI, PR-title lint, the `commit-convention` tripwire, labels,
`dependabot.yml`, and the squash-merge setting are owned here.

## Common commands

```bash
npm ci                 # install deps (needs GitHub Packages auth for @rmartz/*)
npm run format:check   # prettier --check .
npm run format         # prettier --write .
```

There is no build/test suite — the reconciler logic lives in `@rmartz/pr-lifecycle`.

## Releases

Automated via **semantic-release** ([`.releaserc.json`](.releaserc.json)): a merge to
`main` cuts the git tag + GitHub Release. It publishes nothing and commits nothing
back, so the built-in `GITHUB_TOKEN` suffices. Production-dependency bumps are titled
`fix(deps)` and the
[`dependabot-release-type`](.github/workflows/dependabot-release-type.yml) workflow
mirrors the CLI's semver bump into the Action's release type (minor →
`feat(deps):`, major → `feat(deps)!:` + `breaking change`). Dev-dependency and
github-actions bumps stay `chore` and cut no release. See
[docs/design/versioning.md](docs/design/versioning.md).

## Worktrees & PRs

- **Work in a dedicated worktree** under `.git-worktrees/` (`ai-new-worktree`),
  never on `main` in the root checkout. Run `npm ci` in a fresh worktree.
- **PR titles must be Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`,
  `ci:`, …). Render PR/issue numbers as full Markdown links in chat and agent
  output, never a bare `#12`.

## Agent directive files

- **`AGENTS.md` is the single source of truth** for a directory's agent
  instructions — author directives here, never in `CLAUDE.md`.
- **Every `AGENTS.md` has a companion `CLAUDE.md`** in the same directory (a bare
  wrapper whose only content is `@AGENTS.md`), enforced by the `md-pairing` check.
