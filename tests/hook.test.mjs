// Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../hooks/bongo-hook.mjs', import.meta.url));

function setup() {
  const project = mkdtempSync(join(tmpdir(), 'bongo-proj-'));
  const data = mkdtempSync(join(tmpdir(), 'bongo-data-'));
  const run = (cmd, input, env = {}) => {
    const r = spawnSync(process.execPath, [HOOK, cmd], {
      input: typeof input === 'string' ? input : JSON.stringify({ cwd: project, session_id: 's', ...input }),
      env: { ...process.env, CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: '', BONGO_MODE: '', ...env },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout ? JSON.parse(r.stdout) : null;
  };
  const edit = (rel, extra = {}) => run('track', { tool_name: 'Edit', tool_input: { file_path: join(project, rel) }, ...extra });
  return { project, run, edit };
}

test('blocks the stop once after a code edit, listing the file', () => {
  const { run, edit } = setup();
  edit('src/cart.ts');
  const out = run('gate', { stop_hook_active: false });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /src\/cart\.ts/);
  assert.equal(run('gate', {}), null, 'second stop must pass');
});

test('ignores tests, docs, harnesses and vendored code', () => {
  const { run, edit } = setup();
  for (const f of ['README.md', 'src/cart.test.ts', 'tests/a.py', 'pkg/x_test.go', '.bongo/h.js', 'node_modules/a/i.js', 'types.d.ts', 'test_util.py'])
    edit(f);
  assert.equal(run('gate', {}), null);
});

test('stop_hook_active lets Claude stop and forgets edits made during the Bongo run', () => {
  const { run, edit } = setup();
  edit('a.py');
  assert.equal(run('gate', {}).decision, 'block');
  edit('a.py'); // fix made while monkey testing
  assert.equal(run('gate', { stop_hook_active: true }), null);
  assert.equal(run('gate', {}), null);
});

test('mode off via env and via .bongo.json', () => {
  const a = setup();
  a.edit('a.js');
  assert.equal(a.run('gate', {}, { BONGO_MODE: 'off' }), null);

  const b = setup();
  writeFileSync(join(b.project, '.bongo.json'), '{"mode":"off"}');
  b.edit('a.js');
  assert.equal(b.run('gate', {}), null);
});

test('.bongo.json ignore globs', () => {
  const { project, run, edit } = setup();
  writeFileSync(join(project, '.bongo.json'), JSON.stringify({ ignore: ['scripts/**', '*.config.js'] }));
  edit('scripts/deep/x.js');
  edit('vite.config.js');
  assert.equal(run('gate', {}), null);
  edit('src/app.js');
  assert.match(run('gate', {}).reason, /src\/app\.js/);
});

test('nudge mode reminds once and never blocks', () => {
  const { run, edit } = setup();
  const env = { BONGO_MODE: 'nudge' };
  const first = run('track', { tool_input: { file_path: 'a.go' } }, env);
  assert.match(first.hookSpecificOutput.additionalContext, /monkey-test/);
  assert.equal(run('track', { tool_input: { file_path: 'b.go' } }, env), null);
  assert.equal(run('gate', {}, env), null);
  void edit;
});

test('plan mode never blocks', () => {
  const { run, edit } = setup();
  edit('a.rs');
  assert.equal(run('gate', { permission_mode: 'plan' }), null);
});

test('garbage input never breaks the session', () => {
  const { run } = setup();
  assert.equal(run('gate', 'not json'), null);
  assert.equal(run('track', ''), null);
  assert.equal(run('nonsense', {}), null);
});

test('long lists are truncated', () => {
  const { run, edit } = setup();
  for (let i = 0; i < 20; i++) edit(`src/f${i}.ts`);
  const out = run('gate', {});
  assert.match(out.reason, /20 changed code file/);
  assert.match(out.reason, /and 5 more/);
});
