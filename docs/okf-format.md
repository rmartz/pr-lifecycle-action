---
type: Reference
title: The OKF documentation format
description: How this repo's docs bundle uses Open Knowledge Format frontmatter and the nested-index navigability rule, and how both are validated in CI.
tags: [okf, documentation, frontmatter]
---

# The OKF documentation format

Every page under `docs/` is written in **Open Knowledge Format (OKF)**: a directory
of Markdown files, each carrying a small block of YAML frontmatter, linked to one
another with ordinary Markdown links. The frontmatter lets an agent filter and rank
pages by `type` / `tags` and traverse the link graph without a translation layer.

**Authoritative spec:**
[GoogleCloudPlatform/knowledge-catalog `okf/SPEC.md`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md),
and the org's applied conventions in
[`@rmartz/repo-hygiene`'s okf-format](https://github.com/rmartz/repo-hygiene/blob/main/docs/okf-format.md).
This page covers only how _this_ repo uses OKF; the spec wins on any disagreement.

## The fields this repo validates

Configured in [`.repo-hygiene.yml`](../.repo-hygiene.yml) and enforced at `error` by
the `okf` check:

- **`type`** — required, drawn from this repo's small curated set: `Reference`
  (concept/how-it-works pages), `Guidance` (do-this setup pages), and `Design`
  (architecture and rationale under [`design/`](design/index.md)).
- **`title`**, **`description`** — required. `description` is the primary search
  surface; make it one specific sentence.
- **`tags`** — optional; keep the array short and on a single line (the
  zero-dependency parser reads one key per line, so a Prettier-wrapped array
  disappears).
- **`resource`** — optional and exempt for every type here: this repo documents an
  Action and concepts, not a first-party source tree to bind pages to.

`index.md` and `log.md` are the spec's reserved navigational filenames and carry no
concept frontmatter. This repo keeps its `AGENTS.md` / `CLAUDE.md` at the root,
_outside_ `docs/`, precisely so they are not pulled into the OKF bundle (any
non-reserved file under `docs/` would otherwise need frontmatter).

## Navigability and the nested index

The `okf-index` check (also `error` here) enforces that the bundle is fully
navigable from the root [`index.md`](index.md), and it dogfoods the **nested-index**
rule:

- Every directory under `docs/` that holds any `.md` has its own `index.md`.
- An `index.md` may link only **same-directory** files and a **direct child
  directory's** `index.md` — never a page one directory down, never anything deeper.
- Only the bundle-root `index.md` may carry frontmatter, and only `okf_version`.

So [`index.md`](index.md) links the top-level pages and
[`design/index.md`](design/index.md); `design/index.md` in turn links its own pages.
That two-level shape is the smallest real exercise of the nested-index invariant,
which is why the bundle is structured this way rather than flat.
