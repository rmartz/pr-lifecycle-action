#!/usr/bin/env bash
# The token-source step of action.yml. Decides where the real-actor token comes
# from, before the App-token step runs:
#
#   token           the caller passed `token`
#   app             both App inputs are set, so the action creates an
#                   installation token (the next step; it can still fail)
#   app-incomplete  only one App input is set: carry on without a real-actor token
#   none            neither: carry on without a real-actor token
#
# `token` together with an App input is a misconfiguration and fails the run:
# which identity should arm and merge is ambiguous, so the action won't guess.
# The step sees only whether each input is set, never the secrets themselves.
#
# Inputs arrive as environment variables (true/false) set by action.yml. Kept
# bash 3 compatible so the tests run on a stock macOS shell too.
set -euo pipefail

source=none
if [ "${HAS_TOKEN}" = "true" ]; then
  if [ "${HAS_APP_CLIENT_ID}" = "true" ] || [ "${HAS_APP_PRIVATE_KEY}" = "true" ]; then
    echo "::error::pass either token or app-client-id and app-private-key, not both; see docs/consuming.md#the-real-actor-token"
    exit 2
  fi
  source=token
elif [ "${HAS_APP_CLIENT_ID}" = "true" ] && [ "${HAS_APP_PRIVATE_KEY}" = "true" ]; then
  source=app
elif [ "${HAS_APP_CLIENT_ID}" = "true" ] || [ "${HAS_APP_PRIVATE_KEY}" = "true" ]; then
  source=app-incomplete
fi

echo "source=${source}" >>"${GITHUB_OUTPUT}"
