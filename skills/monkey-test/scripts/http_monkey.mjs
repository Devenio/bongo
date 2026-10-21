#!/usr/bin/env node
// Bongo's HTTP monkey: throws seeded garbage at a LOCAL HTTP API and reports
// 5xx responses, hangs, slow responses, leaked stack traces and server deaths.
//
//   node http_monkey.mjs --base http://localhost:3000 --routes "GET /api/items,POST /api/items,GET /api/items/:id"
//   node http_monkey.mjs --base http://127.0.0.1:8000 --spec openapi.json --requests 500 --seed 7
//
// Options:
//   --base URL          API base URL (required). Only localhost-style hosts unless --allow-remote.
//   --routes LIST       Comma-separated "METHOD /path" entries; ":param" and "{param}" are fuzzed.
//   --spec FILE         OpenAPI 3 / Swagger 2 spec in JSON (routes + body field names are read from it).
//   --requests N        Total chaos requests (default 200).
//   --seed N            PRNG seed (default 42). Same seed + same server = same requests.
//   --concurrency N     Parallel requests (default 4).
//   --timeout MS        A request slower than this counts as a hang (default 5000).
//   --slow MS           A request slower than this is reported as slow (default 2000).
//   --header "K: V"     Extra header for every request, e.g. a TEST auth token. Repeatable.
//   --out FILE          Also write the full JSON report to FILE.
//   --reckless          Allow wrong-method mutations to use DELETE (off by default to protect dev data).
//   --allow-remote      Permit non-local hosts. Only for disposable environments you own.
// Requires Node 18+ (global fetch). Exit code: 0 = no findings, 1 = findings, 2 = usage error.

import { readFileSync, writeFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.base) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(args.help ? 0 : 2);
}

const base = new URL(args.base);
if (!isLocal(base.hostname) && !args['allow-remote']) {
  console.error(`🐒 Bongo refuses to monkey with "${base.hostname}": only localhost, 127.x, ::1, *.localhost and *.test are allowed. Use --allow-remote only for disposable environments you own.`);
  process.exit(2);
}

const SEED = Number(args.seed ?? 42);
const TOTAL = Number(args.requests ?? 200);
const CONC = Math.max(1, Number(args.concurrency ?? 4));
const TIMEOUT = Number(args.timeout ?? 5000);
const SLOW = Number(args.slow ?? 2000);
const extraHeaders = Object.fromEntries([].concat(args.header || []).map((h) => {
  const i = h.indexOf(':');
  return [h.slice(0, i).trim(), h.slice(i + 1).trim()];
}));

const rng = mulberry32(SEED);
const pick = (xs) => xs[Math.floor(rng() * xs.length)];
const chance = (p) => rng() < p;

const routes = loadRoutes();
if (!routes.length) {
  console.error('No routes. Pass --routes "GET /path,POST /other" or --spec openapi.json');
  process.exit(2);
}

const CHAOS_STR = ['', ' ', '0', '-1', '1e309', 'NaN', 'null', 'true', '[]', '{}', '\u0000', '👩‍👩‍👧‍👦', '\u202Eevil', 'İı',
  "' OR 1=1 --", '<script>alert(1)</script>', '{{7*7}}', '${7*7}', '../../../etc/passwd', '..%2f..%2f', '%00', '%', '%zz',
  'a'.repeat(300), 'a'.repeat(9000), '__proto__', 'constructor', '9'.repeat(40), '-0', '0x10', ' padded ', 'UPPER', 'ñ'];
const CHAOS_ID = ['0', '-1', '1', '999999999999', '9223372036854775808', 'abc', 'null', 'undefined', '1.5', '1e3', '%20',
  '..%2f..%2fadmin', '%00', '🍌', 'a'.repeat(1000), '00000000-0000-0000-0000-000000000000', 'not-a-uuid', '[]', '1;2'];
const CHAOS_VAL = () => pick([
  () => pick(CHAOS_STR), () => pick([0, -1, 1, -0.0, 2 ** 31, 2 ** 53 + 1, -(2 ** 63), 1e308, 0.1 + 0.2]),
  () => pick([null, true, false]), () => [], () => ({}), () => [pick(CHAOS_STR)], () => ({ nested: { deep: pick(CHAOS_STR) } }),
])();

// --- Mutations: each returns a request descriptor ---
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const mutations = [
  ['baseline', (r) => ({ ...r })],
  ['chaos-path-params', (r) => ({ ...r, path: fillParams(r.path, () => pick(CHAOS_ID)) })],
  ['chaos-query', (r) => ({ ...r, query: chaosQuery() })],
  ['no-body', (r) => ({ ...r, body: undefined, contentType: 'application/json' })],
  ['empty-json', (r) => ({ ...r, body: pick(['{}', '[]', 'null', '""', '0']) })],
  ['malformed-json', (r) => ({ ...r, body: pick(['{"a":', '{a:1}', "{'a':1}", '{"a":1,}', '\uFEFF{"a":1}', 'undefined', '{"a":NaN}', '<xml/>']) })],
  ['chaos-fields', (r) => ({ ...r, body: JSON.stringify(chaosObject(r.fields)) })],
  ['missing-fields', (r) => ({ ...r, body: JSON.stringify(dropSome(validishObject(r.fields))) })],
  ['wrong-types', (r) => ({ ...r, body: JSON.stringify(wrongTypes(r.fields)) })],
  ['proto-pollution', (r) => ({ ...r, body: pick(['{"__proto__":{"isAdmin":true}}', '{"constructor":{"prototype":{"isAdmin":true}}}']) })],
  ['deep-nesting', (r) => ({ ...r, body: '['.repeat(5000) + ']'.repeat(5000) })],
  ['huge-body', (r) => ({ ...r, body: JSON.stringify({ data: 'x'.repeat(2_000_000) }) })],
  ['wrong-content-type', (r) => ({ ...r, body: JSON.stringify(validishObject(r.fields)), contentType: pick(['text/plain', 'application/xml', 'multipart/form-data', 'application/x-www-form-urlencoded', 'application/json; charset=utf-16']) })],
  ['weird-headers', (r) => ({ ...r, headers: { Accept: pick(['*/*;q=0', 'application/xml', 'text/html', '🍌']), 'X-Bongo': 'x'.repeat(pick([10, 4000])), Authorization: pick(['Bearer', 'Bearer null', 'Basic !!!', 'Bearer ' + 'a'.repeat(3000)]) } })],
  ['wrong-method', (r) => ({ ...r, method: pick(['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS', 'HEAD', ...(args.reckless ? ['DELETE'] : [])].filter((m) => m !== r.method)) })],
  ['double-submit', (r) => ({ ...r, repeat: 2 })],
];

// --- Run ---
const findings = new Map(); // signature -> finding
let sent = 0, serverDead = false, everAlive = false;
const started = Date.now();
const statusCounts = {};

console.error(`🐒 Bongo is loose on ${base.origin}: ${routes.length} routes, ${TOTAL} requests, seed ${SEED}`);

// Plan all requests up front so the sequence depends only on the seed.
const plan = [];
for (let i = 0; i < TOTAL; i++) {
  const route = i < routes.length ? routes[i] : pick(routes);
  const [name, mutate] = i < routes.length ? mutations[0] : pick(mutations.slice(1));
  const req = mutate({ ...route });
  // Unfilled params get a plain id for the baseline, chaos otherwise
  req.path = fillParams(req.path, () => (name === 'baseline' ? '1' : pick(['1', ...CHAOS_ID])));
  if (BODY_METHODS.has(req.method) && req.body === undefined && name !== 'no-body') req.body = JSON.stringify(validishObject(route.fields));
  if (!BODY_METHODS.has(req.method)) delete req.body;
  plan.push({ i, name, route: `${route.method} ${route.path}`, req });
}

let next = 0;
await Promise.all(Array.from({ length: CONC }, worker));
report();

async function worker() {
  while (!serverDead && next < plan.length) {
    const item = plan[next++];
    for (let k = 0; k < (item.req.repeat || 1); k++) await fire(item);
  }
}

async function fire({ i, name, route, req }) {
  const url = new URL(req.path.replace(/^\/?/, '/'), base);
  if (base.pathname !== '/') url.pathname = base.pathname.replace(/\/$/, '') + req.path;
  if (req.query) url.search = req.query;
  const headers = { ...extraHeaders, ...(req.headers || {}) };
  if (req.body !== undefined) headers['Content-Type'] = req.contentType || 'application/json';
  const t0 = Date.now();
  sent++;
  try {
    const res = await fetch(url, { method: req.method, headers, body: req.body, signal: AbortSignal.timeout(TIMEOUT), redirect: 'manual' });
    const text = await res.text().catch(() => '');
    const ms = Date.now() - t0;
    everAlive = true;
    statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
    if (res.status >= 500) record('high', '5xx', `${res.status} on ${name}${firstLine(text) ? `: ${firstLine(text)}` : ''}`, { i, route, req, url, status: res.status, ms, snippet: text.slice(0, 300) });
    const leak = leakPattern(text);
    if (leak) record(res.status >= 500 ? 'high' : 'medium', 'leak', `response leaks ${leak}`, { i, route, req, url, status: res.status, ms, snippet: text.slice(0, 300) });
    if (ms > SLOW) record('medium', 'slow', `slow response (${ms} ms) on ${name}`, { i, route, req, url, status: res.status, ms });
    if (res.status < 400 && ['malformed-json', 'wrong-types', 'proto-pollution', 'deep-nesting', 'huge-body'].includes(name) && BODY_METHODS.has(req.method))
      record('low', 'accepts-garbage', `${res.status} accepted on ${name} (expected 4xx)`, { i, route, req, url, status: res.status, ms, snippet: text.slice(0, 200) });
  } catch (e) {
    const ms = Date.now() - t0;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      record('high', 'hang', `no response within ${TIMEOUT} ms on ${name}`, { i, route, req, url, ms });
    } else if (everAlive && /ECONNREFUSED|ECONNRESET|socket|other side closed|fetch failed/i.test(String(e.cause?.code || e.cause?.message || e.message))) {
      // Confirm the server is really gone, not just this one request
      const alive = await fetch(base, { signal: AbortSignal.timeout(TIMEOUT) }).then(() => true, () => false);
      if (!alive) {
        serverDead = true;
        record('critical', 'server-died', `server stopped responding after ${name}`, { i, route, req, url, ms, error: String(e.cause?.code || e.message) });
      } else {
        record('high', 'connection-reset', `connection dropped on ${name}`, { i, route, req, url, ms, error: String(e.cause?.code || e.message) });
      }
    } else if (!everAlive) {
      console.error(`Cannot reach ${base.origin}: ${e.cause?.code || e.message}. Is the server running?`);
      process.exit(2);
    }
  }
}

function record(severity, kind, title, d) {
  const sig = `${kind}|${d.route}|${d.status ?? ''}|${kind === '5xx' ? (d.snippet || '').slice(0, 60) : ''}`;
  const prev = findings.get(sig);
  const bodyLen = d.req.body?.length ?? 0;
  if (prev) {
    prev.count++;
    // keep the smallest reproduction
    if (bodyLen < (prev.req.body?.length ?? 0)) Object.assign(prev, { title, ...d, curl: curl(d) });
    return;
  }
  findings.set(sig, { severity, kind, title, count: 1, ...d, curl: curl(d) });
}

function report() {
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const list = [...findings.values()].sort((a, b) => order[a.severity] - order[b.severity]);
  const result = {
    tool: 'bongo/http_monkey', base: base.origin, seed: SEED, requestsSent: sent, durationMs: Date.now() - started,
    statusCounts, serverDied: serverDead,
    findings: list.map(({ severity, kind, title, count, route, status, ms, snippet, error, curl, i }) =>
      ({ severity, kind, title, route, status, ms, occurrences: count, firstRequestIndex: i, snippet, error, repro: curl })),
  };
  if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.error(list.length
    ? `🍌 Bongo found ${list.length} distinct issue(s) in ${sent} requests. Verify each repro before reporting.`
    : `💪 ${sent} chaos requests, nothing broke. Bongo is sulking.`);
  process.exit(list.length ? 1 : 0);
}

// --- Builders ---
function loadRoutes() {
  const out = [];
  if (args.routes) {
    for (const r of String(args.routes).split(',').map((s) => s.trim()).filter(Boolean)) {
      const [m, p] = r.includes(' ') ? r.split(/\s+/, 2) : ['GET', r];
      out.push({ method: m.toUpperCase(), path: p, fields: [] });
    }
  }
  if (args.spec) {
    let spec;
    try { spec = JSON.parse(readFileSync(args.spec, 'utf8')); }
    catch (e) { console.error(`Cannot read --spec as JSON (${e.message}). Convert YAML to JSON first.`); process.exit(2); }
    for (const [p, ops] of Object.entries(spec.paths || {})) {
      for (const [m, op] of Object.entries(ops)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
        if (m === 'delete' && !args.reckless) continue;
        const schema = op.requestBody?.content?.['application/json']?.schema
          || (op.parameters || []).find((x) => x.in === 'body')?.schema;
        out.push({ method: m.toUpperCase(), path: p, fields: schemaFields(resolveRef(spec, schema)) });
      }
    }
  }
  return out;
}

function schemaFields(schema) {
  if (!schema?.properties) return [];
  return Object.entries(schema.properties).map(([name, s]) => ({ name, type: s.type || 'string', required: (schema.required || []).includes(name) }));
}
function resolveRef(spec, s) {
  if (!s?.$ref) return s;
  return s.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], spec);
}
function fillParams(path, gen) {
  return path.replace(/:(\w+)|\{(\w+)\}/g, () => encodeURIComponent(gen()).replace(/%25/g, '%'));
}
function chaosQuery() {
  const keys = ['page', 'limit', 'offset', 'q', 'sort', 'id', 'filter', 'from', 'to', 'cursor'];
  const parts = [];
  for (let k = 0; k < 1 + Math.floor(rng() * 4); k++) {
    const key = pick(keys);
    const val = pick([...CHAOS_STR.slice(0, 25), '-1', '1e9', '99999999999', 'desc;drop', '']);
    parts.push(chance(0.1) ? `${key}[]=${encodeURIComponent(val)}` : `${key}=${encodeURIComponent(val)}`);
    if (chance(0.15)) parts.push(`${key}=dup`);
  }
  return '?' + parts.join('&');
}
function validishObject(fields) {
  if (!fields?.length) return { name: 'bongo', value: 1 };
  const sample = { string: 'bongo', integer: 1, number: 1.5, boolean: true, array: [], object: {} };
  return Object.fromEntries(fields.map((f) => [f.name, sample[f.type] ?? 'bongo']));
}
function chaosObject(fields) {
  const names = fields?.length ? fields.map((f) => f.name) : ['name', 'email', 'id', 'amount', 'date', 'tags'];
  const o = Object.fromEntries(names.map((n) => [n, CHAOS_VAL()]));
  if (chance(0.3)) o[pick(CHAOS_STR) || 'empty-key'] = CHAOS_VAL();
  return o;
}
function dropSome(o) {
  const keys = Object.keys(o);
  for (const k of keys) if (chance(0.6)) delete o[k];
  return o;
}
function wrongTypes(fields) {
  const o = validishObject(fields);
  for (const k of Object.keys(o)) {
    const v = o[k];
    o[k] = typeof v === 'string' ? pick([123, null, [], {}, true]) : typeof v === 'number' ? pick(['12', 'abc', null, [], '']) : pick(['true', 0, 'x', null]);
  }
  return o;
}
function firstLine(text) {
  return (text || '').split('\n')[0].trim().slice(0, 100);
}
function leakPattern(text) {
  if (!text) return null;
  const pats = [
    [/at \S+ \((?:\/|[A-Z]:\\|file:)[^)]*:\d+:\d+\)/, 'a JS stack trace'],
    [/Traceback \(most recent call last\)/, 'a Python traceback'],
    [/goroutine \d+ \[/, 'a Go panic trace'],
    [/Exception in thread|at [a-z]+\.[\w.$]+\([\w]+\.java:\d+\)/, 'a Java stack trace'],
    [/   at [\w.]+\(.*\) in .*:line \d+/, 'a .NET stack trace'],
    [/node_modules[\\/]/, 'internal file paths'],
    [/SQLSTATE\[|syntax error at or near|ORA-\d{5}|SQLITE_ERROR|You have an error in your SQL syntax/, 'a raw SQL error'],
    [/(?:\/home\/|\/Users\/|C:\\\\Users\\\\)[^\s"']+/, 'server file paths'],
  ];
  for (const [re, what] of pats) if (re.test(text)) return what;
  return null;
}
function curl({ req, url }) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const parts = ['curl -i', '-X', req.method, q(url.href)];
  for (const [k, v] of Object.entries({ ...extraHeaders, ...(req.headers || {}) })) parts.push('-H', q(`${k}: ${String(v).length > 200 ? String(v).slice(0, 40) + '…(truncated)' : v}`));
  if (req.body !== undefined) {
    parts.push('-H', q(`Content-Type: ${req.contentType || 'application/json'}`));
    parts.push('--data-binary', req.body.length > 2000 ? `<${req.body.length}-byte body: rerun with same --seed to reproduce>` : q(req.body));
  }
  return parts.join(' ');
}
function isLocal(h) {
  h = h.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h) || h === '0.0.0.0' || h.endsWith('.localhost') || h.endsWith('.test');
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
    let v = eq > 0 ? a.slice(eq + 1) : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    o[k] = k in o ? [].concat(o[k], v) : v;
  }
  return o;
}
