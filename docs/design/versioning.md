---
type: Design
title: The versioning policy
description: Why the Action carries its own SemVer line independent of the @rmartz/pr-lifecycle CLI, and how a CLI dependency bump maps to an Action release type.
tags: [design, versioning, releases]
---

# The versioning policy

The Action versions **independently** of the
[`@rmartz/pr-lifecycle`](https://github.com/rmartz/pr-lifecycle) CLI it wraps. Its
SemVer describes the _Action's_ contract — its inputs, outputs, required caller
permissions, and observable behavior in a consumer's repo — not the CLI's version
number. The two have separate change streams: an Action-only change (a new input, a
changed default) moves the Action's version with no CLI bump, and a CLI change
reaches consumers only through a new Action release.

## Mapping a CLI bump to an Action release

A CLI bump arrives as a Dependabot `fix(deps):` PR. The
[`dependabot-release-type`](../../.github/workflows/dependabot-release-type.yml)
workflow rewrites its title on open to mirror the CLI's semver bump:

| CLI bump | PR title after mapping             | Action release |
| -------- | ---------------------------------- | -------------- |
| patch    | `fix(deps):`                       | patch          |
| minor    | `feat(deps):`                      | minor          |
| major    | `feat(deps)!:` + `breaking change` | major          |

The major leg is the load-bearing one: a CLI major is the strongest signal of a
consumer-facing break (a changed label set, a different arming rule, a new required
permission), so it defaults to a breaking Action release. A reviewer who confirms the
break is invisible to Action consumers removes the `!` and the label before merging.
The workflow fires only on `opened`/`reopened`, so a later Dependabot rebase does not
re-apply the marker over that deliberate downgrade.

A breaking change can also reach this repo purely as a dependency bump — for
example, a bump of the CLI's `--json` `schemaVersion`, which the Action must adapt
to before consumers can rely on its step outputs. Treat such a bump as a major even
when the CLI's own version change looks smaller.
