---
okf_version: 0.2
---

# Documentation

Documentation for `pr-lifecycle-action`, the composite GitHub Action that runs the
[`@rmartz/pr-lifecycle`](https://github.com/rmartz/pr-lifecycle) reconciler in a
consuming repo. Written in [Open Knowledge Format](okf-format.md).

- [What pr-lifecycle-action is](overview.md) — what the action does, its status,
  and the CLI version it pins.
- [Consuming the action](consuming.md) — the caller workflow, triggers,
  permissions, inputs, outputs, the real-actor token, the `uat` setting and the
  `pr-lifecycle/sign-off` status, moving off `skip-uat`, and an App token for
  `github-token`.
- [The OKF documentation format](okf-format.md) — how these pages are structured
  and validated in this repo.
- [Design & distribution](design/index.md) — how new reconciler versions reach
  consumers automatically, and how the Action is versioned.
