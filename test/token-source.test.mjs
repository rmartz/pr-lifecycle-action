// Tests for where the real-actor token comes from: scripts/token-source.sh, which
// picks the source before the App-token step runs, and scripts/reconcile.sh, which
// sees that step's outcome, falls back to labels only, and reports the source.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { REPO, run } from './harness.mjs';

const tokenSource = new URL('../scripts/token-source.sh', import.meta.url).pathname;

function resolve({ token = false, clientId = false, privateKey = false } = {}) {
  const output = join(mkdtempSync(join(tmpdir(), 'token-source-test-')), 'output');
  writeFileSync(output, '');
  const proc = spawnSync('bash', [tokenSource], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: output,
      HAS_TOKEN: String(token),
      HAS_APP_CLIENT_ID: String(clientId),
      HAS_APP_PRIVATE_KEY: String(privateKey),
    },
  });
  return { status: proc.status, stdout: proc.stdout, output: readFileSync(output, 'utf8') };
}

describe('scripts/token-source.sh picks the real-actor token source', () => {
  it('creates an App token when both App inputs are set', () => {
    const r = resolve({ clientId: true, privateKey: true });
    assert.equal(r.status, 0);
    assert.equal(r.output, 'source=app\n');
  });

  it('uses token when only token is set', () => {
    const r = resolve({ token: true });
    assert.equal(r.status, 0);
    assert.equal(r.output, 'source=token\n');
  });

  it('reports none when nothing is set (secrets not seeded, or a Dependabot run)', () => {
    const r = resolve();
    assert.equal(r.status, 0);
    assert.equal(r.output, 'source=none\n');
  });

  it('reports app-incomplete, without failing, when only the client ID is set', () => {
    const r = resolve({ clientId: true });
    assert.equal(r.status, 0);
    assert.equal(r.output, 'source=app-incomplete\n');
  });

  it('reports app-incomplete, without failing, when only the private key is set', () => {
    const r = resolve({ privateKey: true });
    assert.equal(r.status, 0);
    assert.equal(r.output, 'source=app-incomplete\n');
  });

  it('fails clearly when token is passed with both App inputs', () => {
    const r = resolve({ token: true, clientId: true, privateKey: true });
    assert.equal(r.status, 2);
    assert.match(
      r.stdout,
      /::error::pass either token or app-client-id and app-private-key, not both/,
    );
    assert.equal(r.output, '');
  });

  it('fails clearly when token is passed with one App input', () => {
    const r = resolve({ token: true, privateKey: true });
    assert.equal(r.status, 2);
    assert.equal(r.output, '');
  });

  it('is valid bash', () => {
    execFileSync('bash', ['-n', tokenSource]);
  });
});

describe('scripts/reconcile.sh reports the token source and falls back to labels only', () => {
  it('reports app when the App token was created', () => {
    const r = run({
      env: {
        PR_NUMBER: '7',
        TOKEN_SOURCE: 'app',
        APP_TOKEN_OUTCOME: 'success',
        PR_LIFECYCLE_TOKEN: 'ghs_x',
      },
    });
    assert.equal(r.status, 0);
    assert.equal(r.outputs['token-source'], 'app');
    assert.doesNotMatch(r.stdout, /::warning::/);
  });

  it('reports token when the caller passed one', () => {
    const r = run({ env: { PR_NUMBER: '7', TOKEN_SOURCE: 'token', PR_LIFECYCLE_TOKEN: 'ghp_x' } });
    assert.equal(r.status, 0);
    assert.equal(r.outputs['token-source'], 'token');
  });

  it('reports none, with no warning of its own, when no token was configured', () => {
    const r = run({ env: { PR_NUMBER: '7' } });
    assert.equal(r.status, 0);
    assert.equal(r.outputs['token-source'], 'none');
    assert.doesNotMatch(r.stdout, /::warning::/);
  });

  it('warns and still reconciles when creating the App token failed', () => {
    const r = run({ env: { PR_NUMBER: '7', TOKEN_SOURCE: 'app', APP_TOKEN_OUTCOME: 'failure' } });
    assert.equal(r.status, 0);
    assert.equal(r.outputs['token-source'], 'app-failed');
    assert.match(r.stdout, /::warning::creating the App installation token failed/);
    assert.deepEqual(r.cliCalls, [`reconcile --pr 7 --repo ${REPO} --json --uat on`]);
  });

  it('treats a successful step that produced no token as a failure', () => {
    const r = run({ env: { PR_NUMBER: '7', TOKEN_SOURCE: 'app', APP_TOKEN_OUTCOME: 'success' } });
    assert.equal(r.status, 0);
    assert.equal(r.outputs['token-source'], 'app-failed');
  });

  it('warns and still reconciles when only one App input was set', () => {
    const r = run({ env: { PR_NUMBER: '7', TOKEN_SOURCE: 'app-incomplete' } });
    assert.equal(r.status, 0);
    assert.equal(r.outputs['token-source'], 'app-incomplete');
    assert.match(r.stdout, /::warning::only one of app-client-id and app-private-key is set/);
    assert.equal(r.cliCalls.length, 1);
  });

  it('reports the source even when the event names no PR', () => {
    const r = run({ env: { TOKEN_SOURCE: 'app', APP_TOKEN_OUTCOME: 'failure' } });
    assert.equal(r.status, 0);
    assert.equal(r.outputs['token-source'], 'app-failed');
    assert.equal(r.outputs.results, '[]');
  });
});
