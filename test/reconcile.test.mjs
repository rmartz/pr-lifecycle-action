// Tests for scripts/reconcile.sh, the reconcile step of action.yml. Hermetic: the
// CLI and `gh` are stubs on disk, so nothing reaches the network.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const script = new URL('../scripts/reconcile.sh', import.meta.url).pathname;
const REPO = 'octo/demo';
const REPO_ID = 42;

const baseResult = {
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
};

// The CLI stub logs its argv (one line per call) and prints STUB_RESULT with `pr`
// set to the --pr it was given, or exits 1 for the PR named in STUB_FAIL_PR.
const cliStub = `#!/usr/bin/env bash
echo "$*" >>"$STUB_CLI_LOG"
pr=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--pr" ]; then pr="$2"; fi
  shift
done
if [ "$pr" = "\${STUB_FAIL_PR:-}" ]; then echo "boom" >&2; exit 1; fi
jq -c --argjson pr "$pr" '.pr = $pr' <<<"$STUB_RESULT"
`;

const ghStub = `#!/usr/bin/env bash
echo "$*" >>"$STUB_GH_LOG"
printf '%s' "$STUB_GH_OUTPUT"
`;

function run({ env = {}, event, result = baseResult, gh = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-test-'));
  const binDir = join(dir, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'ai-pr-lifecycle'), cliStub);
  chmodSync(join(binDir, 'ai-pr-lifecycle'), 0o755);
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
      REPO,
      PR_NUMBER: '',
      ARM_AUTO_MERGE: 'false',
      TRUSTED_AUTHORS: '',
      SKIP_COPILOT_REVIEW: 'false',
      HOLD_CHECKS: '',
      IGNORE_CHECKS: '',
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

describe('invokes the pinned CLI with flags mapped 1:1 from the inputs', () => {
  it('passes only --repo, --pr and --json with default inputs', () => {
    const r = run({ env: { PR_NUMBER: '7' } });
    assert.equal(r.status, 0);
    assert.deepEqual(r.cliCalls, [`reconcile --pr 7 --repo ${REPO} --json`]);
  });

  it('maps every set input to its flag', () => {
    const r = run({
      env: {
        PR_NUMBER: '7',
        ARM_AUTO_MERGE: 'true',
        SKIP_COPILOT_REVIEW: 'true',
        DRY_RUN: 'true',
        TOKEN_ADVISORY: 'false',
        TRUSTED_AUTHORS: 'alice,bob',
        HOLD_CHECKS: 'pr-policy,uat',
        IGNORE_CHECKS: 'merge-safety',
      },
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.cliCalls, [
      `reconcile --pr 7 --repo ${REPO} --json --arm-auto-merge --skip-copilot-review --dry-run ` +
        '--no-token-advisory --trusted-authors alice,bob --hold-checks pr-policy,uat --ignore-checks merge-safety',
    ]);
  });

  it('never passes an empty --trusted-authors (no trust-anyone path)', () => {
    const r = run({ env: { PR_NUMBER: '7', TRUSTED_AUTHORS: '' } });
    assert.ok(!r.cliCalls[0].includes('--trusted-authors'));
  });

  it('rejects a boolean input that is not true/false without calling the CLI', () => {
    const r = run({ env: { PR_NUMBER: '7', ARM_AUTO_MERGE: 'True' } });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /::error::input arm-auto-merge must be 'true' or 'false'/);
    assert.deepEqual(r.cliCalls, []);
  });
});

describe('exposes the --json fields as step outputs', () => {
  it('writes each field for a single reconciled PR', () => {
    const r = run({ env: { PR_NUMBER: '7' } });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.outputs.result), baseResult);
    assert.deepEqual(JSON.parse(r.outputs.results), [baseResult]);
    assert.equal(r.outputs['schema-version'], '1');
    assert.equal(r.outputs.state, 'approved');
    assert.equal(r.outputs['add-labels'], '["approved"]');
    assert.equal(r.outputs['remove-labels'], '["review requested"]');
    assert.equal(r.outputs['auto-merge'], 'arm');
    assert.equal(r.outputs['auto-merge-skipped'], '');
    assert.equal(r.outputs['bot-eligible'], 'false');
    assert.deepEqual(JSON.parse(r.outputs['bot-eligibility']), baseResult.botEligibility);
    assert.equal(r.outputs['carry-over'], '');
  });

  it('serialises non-null objects and warns when arming was skipped', () => {
    const result = {
      ...baseResult,
      autoMerge: 'none',
      autoMergeSkipped: { action: 'arm', reason: 'token-missing' },
      carryOver: { cleanAncestors: ['abc'], stoppedBecause: 'no reviews on earlier commits' },
    };
    const r = run({ env: { PR_NUMBER: '7' }, result });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.outputs['auto-merge-skipped']), result.autoMergeSkipped);
    assert.deepEqual(JSON.parse(r.outputs['carry-over']), result.carryOver);
    assert.match(r.stdout, /::warning::#7: auto-merge arm skipped \(token-missing\)/);
    assert.match(r.stdout, /approval carry-over stopped: no reviews on earlier commits/);
  });
});

describe('fails loudly', () => {
  it('on an unknown schemaVersion', () => {
    const r = run({ env: { PR_NUMBER: '7' }, result: { ...baseResult, schemaVersion: 2 } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::ai-pr-lifecycle returned schemaVersion 2 for #7/);
    assert.equal(r.outputs.state, undefined);
  });

  it('when the CLI exits non-zero', () => {
    const r = run({ env: { PR_NUMBER: '7', STUB_FAIL_PR: '7' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::ai-pr-lifecycle reconcile failed for #7/);
  });
});

describe('resolves the PR from the triggering event when pr is empty', () => {
  it('uses the pull_request payload', () => {
    const r = run({ event: { pull_request: { number: 12 } } });
    assert.deepEqual(r.cliCalls, [`reconcile --pr 12 --repo ${REPO} --json`]);
  });

  it('uses a workflow_dispatch pr input', () => {
    const r = run({ event: { inputs: { pr: '13' } } });
    assert.deepEqual(r.cliCalls, [`reconcile --pr 13 --repo ${REPO} --json`]);
  });

  it('prefers the explicit pr input over the event', () => {
    const r = run({ env: { PR_NUMBER: '7' }, event: { pull_request: { number: 12 } } });
    assert.deepEqual(r.cliCalls, [`reconcile --pr 7 --repo ${REPO} --json`]);
  });

  it("reconciles each workflow_run PR into this repo, keeping only per-PR outputs' results", () => {
    const r = run({
      event: {
        workflow_run: {
          head_sha: 'abc',
          pull_requests: [
            { number: 21, base: { repo: { id: REPO_ID } } },
            { number: 20, base: { repo: { id: REPO_ID } } },
            { number: 99, base: { repo: { id: 1 } } },
          ],
        },
      },
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.cliCalls, [
      `reconcile --pr 20 --repo ${REPO} --json`,
      `reconcile --pr 21 --repo ${REPO} --json`,
    ]);
    assert.deepEqual(r.ghCalls, []);
    assert.deepEqual(
      JSON.parse(r.outputs.results).map((x) => x.pr),
      [20, 21],
    );
    assert.equal(r.outputs.state, undefined);
  });

  it('looks up open PRs by head SHA when pull_requests is empty (fork PRs)', () => {
    const r = run({
      event: { check_suite: { head_sha: 'abc123', pull_requests: [] } },
      gh: [
        { number: 30, state: 'open', base: { repo: { full_name: REPO } } },
        { number: 31, state: 'closed', base: { repo: { full_name: REPO } } },
        { number: 32, state: 'open', base: { repo: { full_name: 'someone/else' } } },
      ],
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.ghCalls, [`api --paginate repos/${REPO}/commits/abc123/pulls`]);
    assert.deepEqual(r.cliCalls, [`reconcile --pr 30 --repo ${REPO} --json`]);
  });

  it('succeeds with no CLI call when the event names no open PR', () => {
    const r = run({ event: { workflow_run: { head_sha: 'abc', pull_requests: [] } } });
    assert.equal(r.status, 0);
    assert.deepEqual(r.cliCalls, []);
    assert.equal(r.outputs.results, '[]');
    assert.match(r.stdout, /::notice::No pull request to reconcile/);
  });

  it('keeps reconciling the other PRs when one fails, then fails the step', () => {
    const r = run({
      env: { STUB_FAIL_PR: '20' },
      event: {
        workflow_run: {
          pull_requests: [
            { number: 20, base: { repo: { id: REPO_ID } } },
            { number: 21, base: { repo: { id: REPO_ID } } },
          ],
        },
      },
    });
    assert.equal(r.status, 1);
    assert.equal(r.cliCalls.length, 2);
    assert.deepEqual(
      JSON.parse(r.outputs.results).map((x) => x.pr),
      [21],
    );
  });
});

describe('scripts/reconcile.sh', () => {
  it('is valid bash', () => {
    execFileSync('bash', ['-n', script]);
  });
});
