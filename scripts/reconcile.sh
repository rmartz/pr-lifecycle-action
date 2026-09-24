#!/usr/bin/env bash
# The reconcile step of action.yml. Resolves the PR(s) the triggering event is
# about, runs `ai-pr-lifecycle reconcile --json` on each, and writes the results to
# $GITHUB_OUTPUT. It makes no lifecycle decision of its own: the CLI owns all of
# them (see docs/design/integration-contract.md).
#
# Inputs arrive as environment variables set by action.yml. Kept bash 3
# compatible so the tests run on a stock macOS shell too.
set -euo pipefail

cli="${GITHUB_ACTION_PATH}/node_modules/.bin/ai-pr-lifecycle"

# Boolean inputs arrive as strings. Reject anything but true/false so a typo (e.g.
# `True`, `yes`) fails the run instead of silently disabling the behaviour.
flag() {
  case "$2" in
    true) return 0 ;;
    false) return 1 ;;
    *)
      echo "::error::input $1 must be 'true' or 'false', got '$2'"
      exit 2
      ;;
  esac
}

args=(--repo "${REPO}" --json)
if flag arm-auto-merge "${ARM_AUTO_MERGE}"; then args+=(--arm-auto-merge); fi
if flag skip-copilot-review "${SKIP_COPILOT_REVIEW}"; then args+=(--skip-copilot-review); fi
if flag dry-run "${DRY_RUN}"; then args+=(--dry-run); fi
if ! flag token-advisory "${TOKEN_ADVISORY}"; then args+=(--no-token-advisory); fi
# List inputs are passed only when set, so the CLI's defaults apply otherwise (an
# empty --trusted-authors is a CLI usage error).
if [ -n "${TRUSTED_AUTHORS}" ]; then args+=(--trusted-authors "${TRUSTED_AUTHORS}"); fi
if [ -n "${HOLD_CHECKS}" ]; then args+=(--hold-checks "${HOLD_CHECKS}"); fi
if [ -n "${IGNORE_CHECKS}" ]; then args+=(--ignore-checks "${IGNORE_CHECKS}"); fi

# Print the PR numbers to reconcile, one per line: the `pr` input when set, else
# whatever the event names. check_suite and workflow_run list their PRs in
# pull_requests[], which GitHub leaves empty for fork PRs, so an empty list falls
# back to looking up the open PRs into this repo by the run's head SHA.
resolve_prs() {
  if [ -n "${PR_NUMBER}" ]; then
    echo "${PR_NUMBER}"
    return
  fi
  local event="${GITHUB_EVENT_PATH:-}"
  if [ -z "${event}" ] || [ ! -f "${event}" ]; then
    return
  fi

  local direct
  direct=$(jq -r '.pull_request.number // .inputs.pr // empty' "${event}")
  if [ -n "${direct}" ]; then
    echo "${direct}"
    return
  fi

  local listed
  listed=$(jq -r '.repository.id as $repo
    | (.workflow_run // .check_suite // {}).pull_requests // []
    | .[] | select(.base.repo.id == $repo) | .number' "${event}")
  if [ -n "${listed}" ]; then
    echo "${listed}"
    return
  fi

  local sha
  sha=$(jq -r '(.workflow_run // .check_suite // {}).head_sha // empty' "${event}")
  if [ -n "${sha}" ]; then
    gh api --paginate "repos/${REPO}/commits/${sha}/pulls" \
      | jq -r --arg repo "${REPO}" \
        '.[] | select(.state == "open" and .base.repo.full_name == $repo) | .number'
  fi
}

prs=$(resolve_prs | sort -un)
if [ -z "${prs}" ]; then
  echo "::notice::No pull request to reconcile for this ${GITHUB_EVENT_NAME:-} event."
  echo "results=[]" >>"${GITHUB_OUTPUT}"
  exit 0
fi

results=()
failed=0
for pr in ${prs}; do
  # stdout carries exactly one JSON object; the CLI's logs go to stderr, which
  # streams straight to the job log. Exit 1 is an API failure, 2 a usage error.
  if ! result=$("${cli}" reconcile --pr "${pr}" "${args[@]}"); then
    echo "::error::ai-pr-lifecycle reconcile failed for #${pr} (see the log above)"
    failed=1
    continue
  fi

  schema=$(jq -r '.schemaVersion' <<<"${result}")
  if [ "${schema}" != "1" ]; then
    echo "::error::ai-pr-lifecycle returned schemaVersion ${schema} for #${pr}; this action understands only 1. Update pr-lifecycle-action."
    failed=1
    continue
  fi
  results+=("${result}")

  jq -r '"\(.repo)#\(.pr) → \(.state); auto-merge: \(.autoMerge)"
    + (if .dryRun then " (dry run)" else "" end)' <<<"${result}"
  jq -r '.carryOver.stoppedBecause // empty
    | "approval carry-over stopped: \(.)"' <<<"${result}"
  jq -r '(.pr) as $pr | .autoMergeSkipped // empty
    | "::warning::#\($pr): auto-merge \(.action) skipped (\(.reason)). Pass the token input (secrets.PR_LIFECYCLE_TOKEN); see docs/consuming.md."' <<<"${result}"
done

# Every value is one line: scalars are plain strings, and objects and arrays are
# compact JSON (which escapes any embedded newline). A null object is empty. The
# per-field outputs describe a single PR, so they are set only when exactly one
# was reconciled; `results` always carries every result.
printf '%s\n' ${results[@]+"${results[@]}"} | jq -sc '"results=\(.)"' -r >>"${GITHUB_OUTPUT}"
if [ "${#results[@]}" -eq 1 ]; then
  jq -r '
    def obj: if . == null then "" else tojson end;
    "result=\(tojson)",
    "schema-version=\(.schemaVersion)",
    "state=\(.state)",
    "add-labels=\(.addLabels | tojson)",
    "remove-labels=\(.removeLabels | tojson)",
    "auto-merge=\(.autoMerge)",
    "auto-merge-skipped=\(.autoMergeSkipped | obj)",
    "bot-eligible=\(.botEligibility.eligible)",
    "bot-eligibility=\(.botEligibility | tojson)",
    "carry-over=\(.carryOver | obj)"' <<<"${results[0]}" >>"${GITHUB_OUTPUT}"
fi

exit "${failed}"
