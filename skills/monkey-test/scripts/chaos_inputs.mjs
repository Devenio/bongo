#!/usr/bin/env node
// Bongo's banana bag: a seeded corpus of hostile inputs, as JSON.
//
//   node chaos_inputs.mjs --type string --seed 42 --out test/fixtures/chaos-string.json
//   node chaos_inputs.mjs --type all --count 0 --max-len 500
//
// Types: string, number, integer, date, email, url, path, filename, json, all
// --count N     random values ADDED after the fixed edge cases (default 20; only
//               string/number/integer have generators). Fixed cases are always included.
// --max-len N   cap on every string's length (default 1000)
// --out FILE    write JSON to FILE instead of stdout (recommended: output is large)
//
// Output: {seed, type, values}; values is an array (an object of arrays for
// --type all). Values JSON cannot hold are encoded as:
//   {"$special":"NaN"|"Infinity"|"-Infinity"|"-0"}         -> Number($special)
//   {"$special":"bigint","value":"9223372036854775807"}    -> BigInt(value)
//   {"$special":"unsafe-int","value":"9007199254740993"}   -> integer beyond 2^53, kept as text

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: node chaos_inputs.mjs [--type string|number|integer|date|email|url|path|filename|json|all] [--count N] [--seed N] [--max-len N] [--out FILE]');
  process.exit(0);
}

const TYPE = args.type || 'string';
const TYPES = ['string', 'number', 'integer', 'date', 'email', 'url', 'path', 'filename', 'json', 'all'];
if (!TYPES.includes(TYPE)) {
  console.error(`Unknown --type "${TYPE}". Use one of: ${TYPES.join(', ')}`);
  process.exit(2);
}
const COUNT = intArg('count', 20);
const SEED = intArg('seed', 42);
const MAX_LEN = intArg('max-len', 1000);

const rng = mulberry32(SEED);
const pick = (xs) => xs[Math.floor(rng() * xs.length)];
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

const special = (v) => ({ $special: v });
const bigint = (v) => ({ $special: 'bigint', value: v });
const unsafeInt = (v) => ({ $special: 'unsafe-int', value: v });

const FIXED = {
  string: [
    '', ' ', '  ', '\t', '\n', '\r\n', '\u0000', 'a', 'A', '0',
    'null', 'undefined', 'NaN', 'true', 'false', 'None', 'nil', '[]', '{}', '-0', '1e309', '0x1F', '010',
    'é', 'e\u0301', 'ß', 'İ', 'ı', 'ǅ', 'ﬃ',
    '👩‍👩‍👧‍👦', '🇮🇷', '🐒🍌', '\uD83D', '\uDE00', '\uFEFFbom', '\u200Bzero\u200Bwidth', '\u00A0nbsp',
    'مرحبا بالعالم', 'שלום', 'abc\u202Eevil.txt', '日本語テキスト', '한국어', 'Ω≈ç√∫', 'Z̤͔ͧ̑̓ä͖̭̈̇lͮ̒ͫǧ̗͚̚o̙̔ͮ̇͐̇',
    "' OR 1=1 --", '"; DROP TABLE users; --', '<script>alert(1)</script>', '"><img src=x onerror=alert(1)>',
    '{{7*7}}', '${7*7}', '#{7*7}', '<%= 7*7 %>', '${jndi:ldap://127.0.0.1/a}',
    '../../../../etc/passwd', '..\\..\\..\\windows\\win.ini', '%2e%2e%2f', '%00', 'file:///etc/passwd',
    '%s%s%s%n', '{0}{1}', '%(x)s', '\\', '\\\\', '\\u0000', '"', "'", '`', '$(echo hi)', '; echo hi',
    '\x1b[31mred\x1b[0m', '\x07bell', '\b\b\b', 'line1\u2028line2', '\uFFFD',
    '__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString',
    'a'.repeat(255), 'a'.repeat(256), 'a'.repeat(1025), '9'.repeat(400), '🍌'.repeat(1000),
  ],
  number: [
    0, special('-0'), 1, -1, 0.1, -0.1, 0.30000000000000004, 0.005, 1.005, 2.675,
    special('NaN'), special('Infinity'), special('-Infinity'),
    127, 128, 255, 256, 32767, 32768, 65535, 65536,
    2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296,
    9007199254740991, 9007199254740992, unsafeInt('9007199254740993'), unsafeInt('-9007199254740993'), -9007199254740991,
    bigint('9223372036854775807'), bigint('-9223372036854775808'), bigint('18446744073709551615'),
    1e-7, 5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, -1.7976931348623157e308, 1e21, 123456789.123456789,
  ],
  date: [
    '1970-01-01T00:00:00Z', '1969-12-31T23:59:59Z', '2000-02-29', '1900-02-29', '2100-02-29', '2024-02-29', '2023-02-29',
    '2024-12-31T23:59:59.999Z', '2025-01-01T00:00:00Z', '2038-01-19T03:14:07Z', '2038-01-19T03:14:08Z',
    '0000-01-01', '0001-01-01', '9999-12-31T23:59:59Z', '10000-01-01', '-000001-01-01T00:00:00Z',
    '2024-03-10T02:30:00 America/New_York', '2024-11-03T01:30:00 America/New_York', '2024-03-31T02:30:00 Europe/Berlin',
    '2024-06-01T12:00:00+14:00', '2024-06-01T12:00:00-12:00', '2024-06-01T12:00:00+05:45', '2024-06-01T12:00:00+03:30',
    '2016-12-31T23:59:60Z', '2024-13-01', '2024-00-10', '2024-04-31', '2024-01-32', '24:00', '2024-1-1', '01/02/03',
    '1404/07/29', 'yesterday', '', 'NaN', '1e12', '1700000000', '1700000000000', 'Tue, 30 Feb 2024 10:00:00 GMT',
  ],
  email: [
    'a@b.co', 'a@b', '@b.com', 'a@', 'a@@b.com', 'a.@b.com', '.a@b.com', 'a..b@c.com', 'A@B.COM', 'a+tag@b.com',
    '"quoted local"@b.com', '"a@b"@c.com', 'a@[127.0.0.1]', 'a@[IPv6:::1]', 'user@xn--bcher-kva.example', 'юзер@пример.рф',
    'a@b.c', `${'a'.repeat(64)}@b.com`, `${'a'.repeat(65)}@b.com`, `a@${'b'.repeat(250)}.com`, ' a@b.com', 'a@b.com ',
    'a@b.com\n', 'a@b.com,c@d.com', 'a@b.com\r\nBcc: x@y.z', 'a"b(c)d,e:f;g<h>i[j\\k]l@example.com',
  ],
  url: [
    'http://localhost', 'https://example.com/', 'example.com', '//example.com', 'http:/example.com', 'http://',
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'ftp://x',
    'http://user:pass@example.com', 'http://[::1]:8080/', 'http://127.0.0.1:0', 'http://127.0.0.1:99999', 'http://0x7f.1',
    'http://xn--n3h.com', 'http://☃.com', 'https://example.com/a b', 'https://example.com/%zz', 'https://example.com/?a=1&a=2',
    'https://example.com/#', 'https://example.com/../../', 'https://example.com//double//slash', `https://example.com/${'a'.repeat(3000)}`,
    'HTTPS://EXAMPLE.COM', ' https://example.com', 'https://example.com\u0000.evil.com', 'http://169.254.169.254/latest/meta-data/',
  ],
  path: [
    '', '.', '..', '/', '\\', '~', '~/x', './a/../../b', '../../etc/passwd', 'C:\\Windows\\win.ini', 'C:', '\\\\server\\share',
    'a/b/c/', 'a//b', 'a\\b/c', '/tmp/a b/c', '/tmp/ünïcödé/ファイル', '/tmp/\u202Etxt.exe', `/tmp/${'a'.repeat(300)}`,
    'nul', 'CON', 'aux.txt', 'COM1', 'file.', 'file ', '-rf', '--help', '*', '?', '[a-z]', '$HOME', '%APPDATA%', '\u0000',
  ],
  filename: [
    'a.txt', '.hidden', '..', '.', 'noext', 'double.ext.tar.gz', 'UPPER.TXT', 'space name.txt', ' lead.txt', 'trail.txt ',
    'CON', 'NUL.txt', 'com1.log', 'trailingdot.', 'a:b.txt', 'a|b.txt', 'a"b.txt', 'a<b>.txt', 'a*?.txt', 'a/b.txt', 'a\\b.txt',
    '🍌.png', 'résumé.pdf', 'e\u0301.txt', 'evil\u202Egnp.exe', `${'x'.repeat(255)}.txt`, '-n', '--', '.git', '.env', '\u0000.txt',
  ],
  json: [
    '', ' ', 'null', 'true', '0', '-0', '1e400', '"str"', '[]', '{}', '[[[[[[[[[[]]]]]]]]]]', '{"a":1,}', '[1,2,]',
    '{"a":1,"a":2}', '{"__proto__":{"polluted":true}}', '{"constructor":{"prototype":{"polluted":true}}}',
    '{"a":NaN}', '{"a":Infinity}', "{'a':1}", '{a:1}', '{"a":"\\ud800"}', '\uFEFF{"a":1}', '{"a":1}garbage', '{"a":',
    '{"n":12345678901234567890123}', '{"n":0.1e-400}', '{"s":"\\u0000"}', JSON.stringify({ deep: nest(200) }),
    JSON.stringify({ big: 'x'.repeat(Math.min(MAX_LEN, 100000)) }),
  ],
};
// Integer-valued only: no NaN/Infinity, but -0 and the huge/unsafe ones stay
FIXED.integer = FIXED.number.filter((n) => (typeof n === 'object' ? !/Infinity|NaN/.test(n.$special) : Number.isInteger(n)));

const GEN = {
  string: () => {
    const alphabets = [
      'abcdefghijklmnopqrstuvwxyz', '0123456789', ' \t\n\r', '!@#$%^&*()_+-=[]{};:\'",.<>/?\\|`~',
      'éßİıçñøåΩжюمرשל日本語한', '🍌🐒👩‍👩‍👧‍👦🇮🇷✨', '\u0000\u0007\u001b\u200B\u202E\uFEFF\u2028',
    ];
    const len = pick([0, 1, 2, int(3, 20), int(20, 200), int(200, MAX_LEN)]);
    let s = '';
    for (let i = 0; i < len; i++) s += pick([...pick(alphabets)]);
    return s.slice(0, MAX_LEN);
  },
  number: () => pick([
    () => int(-1000, 1000),
    () => (rng() - 0.5) * 10 ** int(-10, 20),
    () => 2 ** int(0, 64) * pick([1, -1]) + pick([-1, 0, 1]),
  ])(),
  integer: () => pick([() => int(-1000, 1000), () => 2 ** int(0, 53) * pick([1, -1]) + pick([-1, 0, 1])]),
};

function corpus(type) {
  const out = shuffle([...FIXED[type]]);
  const gen = GEN[type];
  if (gen) for (let i = 0; i < COUNT; i++) out.push(gen());
  else if (args.count !== undefined && COUNT > 0 && TYPE !== 'all') console.error(`note: "${type}" has no random generator; --count adds nothing (${out.length} fixed values).`);
  return out.map((v) => (typeof v === 'string' && v.length > MAX_LEN ? v.slice(0, MAX_LEN) : v));
}

const result = TYPE === 'all'
  ? Object.fromEntries(Object.keys(FIXED).map((t) => [t, corpus(t)]))
  : corpus(TYPE);
const json = JSON.stringify({ seed: SEED, type: TYPE, values: result }, null, 2) + '\n';
if (args.out) {
  mkdirSync(dirname(resolve(String(args.out))), { recursive: true });
  writeFileSync(String(args.out), json);
  const n = Array.isArray(result) ? result.length : Object.values(result).reduce((a, v) => a + v.length, 0);
  console.error(`🍌 wrote ${n} values to ${args.out}`);
} else {
  process.stdout.write(json);
}

// --- helpers ---
function intArg(name, def) {
  if (args[name] === undefined) return def;
  const n = Number(args[name]);
  if (args[name] === true || args[name] === '' || !Number.isInteger(n) || n < 0) {
    console.error(`--${name} must be a non-negative integer, got "${args[name]}"`);
    process.exit(2);
  }
  return n;
}
function nest(depth) { let v = 0; for (let i = 0; i < depth; i++) v = [v]; return v; }
function shuffle(xs) {
  for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
  return xs;
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
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) o[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) o[k] = argv[++i];
    else o[k] = true;
  }
  return o;
}
