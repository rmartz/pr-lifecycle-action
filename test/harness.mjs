// Shared harness for the tests of scripts/reconcile.sh. Hermetic: the CLI and
// `gh` are stubs on disk, so nothing reaches the network.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const script = new URL('../scripts/reconcile.sh', import.meta.url).pathname;
export const REPO = 'octo/demo';
export const REPO_ID = 42;

export const baseResult = {
  schemaVersion: 1,
  repo: REPO,
  pr: 7,
  dryRun: false,
  state: 'approved',
  addLabels: ['approved'],
  removeLabels: ['review requested'],
  autoMerge: 'arm',
  botEligibility: {
    eligible: false,
    reason: 'not a recognized bot PR',
    prType: null,
    updateType: null,
  },
  carryOver: null,
  autoMergeSkipped: null,
  update: 'none',
  updateSkipped: null,
  uat: { outcome: 'ready', label: 'UAT ready' },
  signOff: {
    requirement: 'uat',
    reason: 'needs-uat',
    loosening: false,
    status: 'v1 requirement=uat waiver=absent',
    statusPosted: true,
  },
  signOffStatusSkipped: null,
};

// The CLI stub logs its argv (one line per call) and prints STUB_RESULT with `pr`
// set to the --pr it was given, or exits 1 for the PR named in STUB_FAIL_PR and 75
// (a transient failure) for the one named in STUB_TRANSIENT_PR.
const cliStub = `#!/usr/bin/env bash
echo "$*" >>"$STUB_CLI_LOG"
pr=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--pr" ]; then pr="$2"; fi
  shift
done
if [ "$pr" = "\${STUB_FAIL_PR:-}" ]; then echo "boom" >&2; exit 1; fi
if [ "$pr" = "\${STUB_TRANSIENT_PR:-}" ]; then echo "rate limited" >&2; exit 75; fi
jq -c --argjson pr "$pr" '.pr = $pr' <<<"$STUB_RESULT"
`;

const ghStub = `#!/usr/bin/env bash
echo "$*" >>"$STUB_GH_LOG"
case "$*" in
  */cancel) if [ -n "\${STUB_GH_CANCEL_FAIL:-}" ]; then echo "HTTP 403" >&2; exit 1; fi ;;
esac
printf '%s' "$STUB_GH_OUTPUT"
`;

export function run({ env = {}, event, result = baseResult, gh = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-test-'));
  const binDir = join(dir, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'pr-lifecycle'), cliStub);
  chmodSync(join(binDir, 'pr-lifecycle'), 0o755);
  const pathDir = join(dir, 'path');
  mkdirSync(pathDir);
  writeFileSync(join(pathDir, 'gh'), ghStub);
  chmodSync(join(pathDir, 'gh'), 0o755);

  const files = {
    output: join(dir, 'output'),
    cliLog: join(dir, 'cli.log'),
    ghLog: join(dir, 'gh.log'),
    event: join(dir, 'event.json'),
  };
  for (const f of [files.output, files.cliLog, files.ghLog]) writeFileSync(f, '');
  if (event) writeFileSync(files.event, JSON.stringify({ repository: { id: REPO_ID }, ...event }));

  const proc = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      PATH: `${pathDir}:${process.env.PATH}`,
      GITHUB_ACTION_PATH: dir,
      GITHUB_OUTPUT: files.output,
      GITHUB_EVENT_PATH: event ? files.event : '',
      GITHUB_EVENT_NAME: 'test',
      GITHUB_RUN_ID: '555',
      PR_LIFECYCLE_CANCEL_WAIT: '0',
      REPO,
      PR_NUMBER: '',
      PR_LIFECYCLE_TOKEN: '',
      TOKEN_SOURCE: 'none',
      APP_TOKEN_OUTCOME: '',
      ARM_AUTO_MERGE: 'false',
      AUTO_UPDATE: 'false',
      TRUSTED_AUTHORS: '',
      SKIP_COPILOT_REVIEW: 'false',
      HOLD_CHECKS: '',
      IGNORE_CHECKS: '',
      UAT: 'on',
      TOKEN_ADVISORY: 'true',
      DRY_RUN: 'false',
      STUB_CLI_LOG: files.cliLog,
      STUB_GH_LOG: files.ghLog,
      STUB_RESULT: JSON.stringify(result),
      STUB_GH_OUTPUT: JSON.stringify(gh),
      ...env,
    },
  });

  const outputs = {};
  for (const line of readFileSync(files.output, 'utf8').split('\n').filter(Boolean)) {
    const i = line.indexOf('=');
    outputs[line.slice(0, i)] = line.slice(i + 1);
  }
  const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean);
  return {
    status: proc.status,
    stdout: proc.stdout,
    outputs,
    cliCalls: lines(files.cliLog),
    ghCalls: lines(files.ghLog),
  };
}
