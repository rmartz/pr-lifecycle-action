# Design & distribution

How new versions of the reconciler reach consumers with no per-repo work, and how
the Action is versioned.

- [The integration contract](integration-contract.md) — what the action relies on
  from the CLI, what it adds around it, and what it never does.
- [The distribution pipeline](distribution-pipeline.md) — the CLI bump → auto-merge
  → release → consumer Dependabot chain that ships new versions automatically.
- [The versioning policy](versioning.md) — why the Action carries its own SemVer
  line independent of the CLI, and how a CLI bump maps to an Action release type.
