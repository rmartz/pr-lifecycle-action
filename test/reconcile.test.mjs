// Tests for scripts/reconcile.sh, the reconcile step of action.yml. Hermetic: the
// CLI and `gh` are stubs on disk, so nothing reaches the network.
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, REPO_ID, baseResult, run, script } from './harness.mjs';

describe('invokes the pinned CLI with flags mapped 1:1 from the inputs', () => {
  it('passes only --repo, --pr, --json and --uat on with default inputs', () => {
    const r = run({ env: { PR_NUMBER: '7' } });
    assert.equal(r.status, 0);
    assert.deepEqual(r.cliCalls, [`reconcile --pr 7 --repo ${REPO} --json --uat on`]);
  });

  it('maps every set input to its flag', () => {
    const r = run({
      env: {
        PR_NUMBER: '7',
        ARM_AUTO_MERGE: 'true',
        AUTO_UPDATE: 'true',
        SKIP_COPILOT_REVIEW: 'true',
        DRY_RUN: 'true',
        TOKEN_ADVISORY: 'false',
        TRUSTED_AUTHORS: 'alice,bob',
        HOLD_CHECKS: 'pr-policy,uat',
        IGNORE_CHECKS: 'merge-safety',
        UAT: 'off',
      },
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.cliCalls, [
      `reconcile --pr 7 --repo ${REPO} --json --arm-auto-merge --auto-update --skip-copilot-review --dry-run ` +
        '--no-token-advisory --trusted-authors alice,bob --hold-checks pr-policy,uat --ignore-checks merge-safety ' +
        '--uat off',
    ]);
  });

  it('rejects a uat input that is not on/off without calling the CLI', () => {
    const r = run({ env: { PR_NUMBER: '7', UAT: 'false' } });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /::error::input uat must be 'on' or 'off', got 'false'/);
    assert.deepEqual(r.cliCalls, []);
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
    assert.equal(r.outputs.update, 'none');
    assert.equal(r.outputs['update-skipped'], '');
    assert.deepEqual(JSON.parse(r.outputs.uat), baseResult.uat);
    assert.deepEqual(JSON.parse(r.outputs['sign-off']), baseResult.signOff);
    assert.equal(r.outputs['sign-off-status-skipped'], '');
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

  it('serialises a skipped branch update and warns about it', () => {
    const result = {
      ...baseResult,
      updateSkipped: { action: 'update-branch', reason: 'token-missing' },
    };
    const r = run({ env: { PR_NUMBER: '7' }, result });
    assert.equal(r.status, 0);
    assert.equal(r.outputs.update, 'none');
    assert.deepEqual(JSON.parse(r.outputs['update-skipped']), result.updateSkipped);
    assert.match(r.stdout, /::warning::#7: branch update update-branch skipped \(token-missing\)/);
  });

  it('serialises a skipped sign-off status and warns that pr-policy holds the PR', () => {
    const result = {
      ...baseResult,
      signOff: { ...baseResult.signOff, statusPosted: false },
      signOffStatusSkipped: { reason: 'token-missing' },
    };
    const r = run({ env: { PR_NUMBER: '7' }, result });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.outputs['sign-off-status-skipped']), result.signOffStatusSkipped);
    assert.match(
      r.stdout,
      /::warning::#7: sign-off status skipped \(token-missing\), so pr-policy holds the PR/,
    );
  });

  it('leaves the UAT and sign-off outputs empty when the CLI reports none (a closed PR)', () => {
    const result = { ...baseResult, uat: null, signOff: null };
    const r = run({ env: { PR_NUMBER: '7' }, result });
    assert.equal(r.status, 0);
    assert.equal(r.outputs.uat, '');
    assert.equal(r.outputs['sign-off'], '');
  });
});

describe('fails loudly', () => {
  it('on an unknown schemaVersion', () => {
    const r = run({ env: { PR_NUMBER: '7' }, result: { ...baseResult, schemaVersion: 2 } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::pr-lifecycle returned schemaVersion 2 for #7/);
    assert.equal(r.outputs.state, undefined);
  });

  it('when the CLI exits non-zero', () => {
    const r = run({ env: { PR_NUMBER: '7', STUB_FAIL_PR: '7' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::pr-lifecycle reconcile failed for #7/);
  });
});

describe('reports a transient CLI failure (exit 75) as a cancelled run', () => {
  const cancel = `api --method POST repos/${REPO}/actions/runs/555/cancel`;

  it('asks the API to cancel the run', () => {
    const r = run({ env: { PR_NUMBER: '7', STUB_TRANSIENT_PR: '7' } });
    assert.deepEqual(r.ghCalls, [cancel]);
    assert.match(
      r.stdout,
      /::warning::pr-lifecycle reconcile for #7 was interrupted by a transient failure/,
    );
    assert.match(r.stdout, /Cancelling this run/);
  });

  it('succeeds when the cancel does not land in time', () => {
    const r = run({ env: { PR_NUMBER: '7', STUB_TRANSIENT_PR: '7' } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /::warning::the run was not cancelled in time/);
  });

  it('warns and succeeds when the run cannot be cancelled (no actions: write)', () => {
    const r = run({ env: { PR_NUMBER: '7', STUB_TRANSIENT_PR: '7', STUB_GH_CANCEL_FAIL: '1' } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /::warning::could not cancel the run after a transient failure/);
  });

  it('keeps reconciling the other PRs and reports their results', () => {
    const r = run({
      env: { STUB_TRANSIENT_PR: '20' },
      event: {
        workflow_run: {
          pull_requests: [
            { number: 20, base: { repo: { id: REPO_ID } } },
            { number: 21, base: { repo: { id: REPO_ID } } },
          ],
        },
      },
    });
    assert.equal(r.cliCalls.length, 2);
    assert.deepEqual(
      JSON.parse(r.outputs.results).map((x) => x.pr),
      [21],
    );
  });

  it('fails without cancelling when another PR failed for real', () => {
    const r = run({
      env: { STUB_TRANSIENT_PR: '20', STUB_FAIL_PR: '21' },
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
    assert.deepEqual(r.ghCalls, []);
  });

  it('does not cancel a run with no transient failure', () => {
    const r = run({ env: { PR_NUMBER: '7' } });
    assert.deepEqual(r.ghCalls, []);
  });
});

describe('resolves the PR from the triggering event when pr is empty', () => {
  it('uses the pull_request payload', () => {
    const r = run({ event: { pull_request: { number: 12 } } });
    assert.deepEqual(r.cliCalls, [`reconcile --pr 12 --repo ${REPO} --json --uat on`]);
  });

  it('uses a workflow_dispatch pr input', () => {
    const r = run({ event: { inputs: { pr: '13' } } });
    assert.deepEqual(r.cliCalls, [`reconcile --pr 13 --repo ${REPO} --json --uat on`]);
  });

  it('prefers the explicit pr input over the event', () => {
    const r = run({ env: { PR_NUMBER: '7' }, event: { pull_request: { number: 12 } } });
    assert.deepEqual(r.cliCalls, [`reconcile --pr 7 --repo ${REPO} --json --uat on`]);
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
      `reconcile --pr 20 --repo ${REPO} --json --uat on`,
      `reconcile --pr 21 --repo ${REPO} --json --uat on`,
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
    assert.deepEqual(r.cliCalls, [`reconcile --pr 30 --repo ${REPO} --json --uat on`]);
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
