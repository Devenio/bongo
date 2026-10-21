// Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const script = (name) => fileURLToPath(new URL(`../skills/monkey-test/scripts/${name}`, import.meta.url));
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts });

test('chaos_inputs is deterministic per seed; --count adds random values on top of every fixed case', () => {
  const run = (...a) => node([script('chaos_inputs.mjs'), '--type', 'string', '--seed', '9', ...a]);
  const a = run('--count', '30');
  assert.equal(a.status, 0);
  assert.equal(a.stdout, run('--count', '30').stdout);
  const fixedOnly = JSON.parse(run('--count', '0').stdout).values;
  assert.equal(JSON.parse(a.stdout).values.length, fixedOnly.length + 30);
  assert.ok(fixedOnly.includes('') && fixedOnly.includes('__proto__'));
});

test('chaos_inputs covers every type, encodes unsafe numbers, rejects bad args', () => {
  const all = JSON.parse(node([script('chaos_inputs.mjs'), '--type', 'all', '--count', '0', '--max-len', '50']).stdout).values;
  for (const t of ['string', 'number', 'integer', 'date', 'email', 'url', 'path', 'filename', 'json']) assert.ok(all[t].length > 10, t);
  assert.ok(all.string.every((v) => v.length <= 50));
  assert.ok(all.number.some((v) => v?.$special === 'unsafe-int' && v.value === '9007199254740993'));
  assert.ok(all.number.some((v) => v?.$special === 'bigint'));
  assert.ok(!all.integer.some((v) => v?.$special === 'NaN'));
  assert.equal(node([script('chaos_inputs.mjs'), '--type', 'banana']).status, 2);
  assert.equal(node([script('chaos_inputs.mjs'), '--count', 'abc']).status, 2);
});

test('detect_stack reports JSON for any directory', () => {
  const r = node([script('detect_stack.mjs'), fileURLToPath(new URL('..', import.meta.url))]);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.languages));
  assert.ok(Array.isArray(out.recommendations));
});

test('http_monkey refuses remote hosts', () => {
  const r = node([script('http_monkey.mjs'), '--base', 'https://example.com', '--routes', 'GET /']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refuses/);
});

test('http_monkey finds a planted 500 and a stack trace leak', async () => {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    try {
      if (req.method === 'POST') { const d = JSON.parse(body); res.end(String(d.name.trim())); return; }
      res.end('ok');
    } catch (e) { res.statusCode = 500; res.end(e.stack); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const child = await new Promise((resolve) => {
    const p = spawn(process.execPath, [script('http_monkey.mjs'), '--base', `http://127.0.0.1:${port}`, '--routes', 'POST /items', '--requests', '60', '--seed', '1']);
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.on('close', (code) => resolve({ code, out }));
  });
  server.close();
  assert.equal(child.code, 1);
  const kinds = JSON.parse(child.out).findings.map((f) => f.kind);
  assert.ok(kinds.includes('5xx'));
  assert.ok(kinds.includes('leak'));
});
