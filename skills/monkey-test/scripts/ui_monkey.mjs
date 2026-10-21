#!/usr/bin/env node
// Bongo's UI monkey: a seeded random walk through a LOCAL web app with
// Playwright. Clicks, types hostile strings, scrolls, resizes, presses keys,
// goes back and forward, flips offline, and records everything that breaks.
//
//   node ui_monkey.mjs --url http://localhost:5173 --seed 7 --actions 300
//   node ui_monkey.mjs --url http://localhost:3000/app --channel chrome --headed
//
// Options:
//   --url URL         Start page (required). Only localhost-style hosts unless --allow-remote.
//   --actions N       Number of random actions (default 200).
//   --seed N          PRNG seed (default 42). Replays the same action choices.
//   --browser NAME    chromium | firefox | webkit (default chromium).
//   --channel NAME    Use an installed browser instead of Playwright's: chrome | msedge.
//   --headed          Show the browser window.
//   --out DIR         Where screenshots and bongo-ui-report.json go (default .bongo/ui).
//   --slowmo MS       Delay between actions (default 0).
//   --reckless        Also click destructive-looking controls (delete, pay, logout, ...).
//   --allow-remote    Permit non-local hosts. Only for disposable environments you own.
// Needs Playwright resolvable from the current directory:
//   npm i -D playwright && npx playwright install chromium   (or pass --channel chrome)
// Exit code: 0 = no findings, 1 = findings, 2 = setup error.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.url) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(args.help ? 0 : 2);
}

const start = new URL(args.url);
if (!isLocal(start.hostname) && !args['allow-remote']) {
  console.error(`🐒 Bongo refuses to monkey with "${start.hostname}": only localhost, 127.x, ::1, *.localhost and *.test are allowed.`);
  process.exit(2);
}

const SEED = Number(args.seed ?? 42);
const ACTIONS = Number(args.actions ?? 200);
const OUT = resolve(args.out || '.bongo/ui');
const XSS_MARK = 'bongo-xss-' + SEED;
const DESTRUCTIVE = /\b(delete|remove|destroy|drop|erase|wipe|purge|pay|purchase|buy|checkout|place order|confirm order|log ?out|sign ?out|unsubscribe|deactivate|close account|reset)\b/i;

const rng = mulberry32(SEED);
const pick = (xs) => xs[Math.floor(rng() * xs.length)];
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

const CHAOS_TEXT = ['', ' ', 'a', '0', '-1', '1e309', 'NaN', 'null', '👩‍👩‍👧‍👦🍌', '‮evil', 'İstanbul ß', 'مرحبا',
  `<img src=x onerror=alert('${XSS_MARK}')>`, `"><svg onload=alert('${XSS_MARK}')>`, "' OR 1=1 --", '{{7*7}}', '${7*7}',
  '../../etc/passwd', 'a'.repeat(5000), '   leading and trailing   ', 'line1\nline2', '\t', 'test@example', 'x@y.z',
  '2024-02-30', '99999999999999999999', '0.1', '-0', '%00', '\\', '"', "'"];
const VIEWPORTS = [[320, 568], [375, 812], [768, 1024], [1280, 800], [1920, 1080], [2560, 1440], [500, 300]];

// --- Load Playwright from the project ---
const req = createRequire(join(process.cwd(), 'bongo-noop.js'));
let pw;
for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
  try { pw = req(name); break; } catch { /* try next */ }
}
if (!pw) {
  console.error('Playwright not found from this directory. Install it with:\n  npm i -D playwright && npx playwright install chromium\nor use an installed browser: npm i -D playwright-core, then pass --channel chrome (or msedge).');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const findings = [];
const seen = new Set();
const log = []; // action history for repro steps
let step = 0;

let browser;
try {
  browser = await pw[args.browser || 'chromium'].launch({ headless: !args.headed, channel: args.channel, slowMo: Number(args.slowmo || 0) });
} catch (e) {
  console.error(`Could not launch the browser: ${e.message.split('\n')[0]}\nRun "npx playwright install chromium" or pass --channel chrome / --channel msedge.`);
  process.exit(2);
}
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

// --- Watchers ---
page.on('pageerror', (err) => finding('high', 'uncaught-exception', err.message.split('\n')[0], err.stack));
page.on('console', (msg) => { if (msg.type() === 'error' && !/ERR_INTERNET_DISCONNECTED/.test(msg.text())) finding('medium', 'console-error', msg.text().slice(0, 200)); });
page.on('response', (res) => { if (res.status() >= 500) finding('high', 'http-5xx', `${res.status()} ${res.request().method()} ${trimUrl(res.url())}`); });
page.on('requestfailed', (r) => {
  const why = r.failure()?.errorText || '';
  if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled|ERR_INTERNET_DISCONNECTED/i.test(why)) finding('low', 'request-failed', `${r.method()} ${trimUrl(r.url())}: ${why}`);
});
page.on('crash', () => finding('critical', 'page-crash', 'the page crashed'));
page.on('dialog', async (d) => {
  if (d.message().includes(XSS_MARK)) finding('critical', 'xss', `injected script executed via ${d.type()}() (payload typed into a field ran)`);
  await d.dismiss().catch(() => {});
});

console.error(`🐒 Bongo is loose on ${start.href}: ${ACTIONS} actions, seed ${SEED}`);
await page.goto(start.href, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch((e) => {
  console.error(`Cannot open ${start.href}: ${e.message.split('\n')[0]}. Is the dev server running?`);
  process.exit(2);
});

// --- Actions ---
const actions = [
  [30, 'click', clickSomething],
  [16, 'type', typeSomething],
  [6, 'double-click', () => clickSomething({ double: true })],
  [6, 'select', selectSomething],
  [6, 'form-blitz', formBlitz],
  [8, 'scroll', async () => { const y = int(-800, 1600); await page.mouse.wheel(0, y); return `wheel ${y}`; }],
  [8, 'key', async () => { const k = pick(['Tab', 'Enter', 'Escape', 'Space', 'ArrowDown', 'ArrowUp', 'Backspace', 'Shift+Tab']); await page.keyboard.press(k); return k; }],
  [5, 'click-anywhere', async () => { const vp = page.viewportSize(); const x = int(0, vp.width - 1), y = int(0, vp.height - 1); await page.mouse.click(x, y); return `(${x},${y})`; }],
  [4, 'resize', async () => { const [w, h] = pick(VIEWPORTS); await page.setViewportSize({ width: w, height: h }); return `${w}x${h}`; }],
  [3, 'back', async () => { await page.goBack({ timeout: 5000 }).catch(() => {}); return 'back'; }],
  [2, 'forward', async () => { await page.goForward({ timeout: 5000 }).catch(() => {}); return 'forward'; }],
  [2, 'reload', async () => { await page.reload({ timeout: 10000 }).catch(() => {}); return 'reload'; }],
  [2, 'offline-blip', async () => { await context.setOffline(true); await clickSomething(); await page.waitForTimeout(300); await context.setOffline(false); return 'offline + click + online'; }],
];
const weightSum = actions.reduce((s, a) => s + a[0], 0);

for (step = 1; step <= ACTIONS; step++) {
  if (page.isClosed()) break;
  let r = rng() * weightSum, chosen = actions[0];
  for (const a of actions) { if ((r -= a[0]) < 0) { chosen = a; break; } }
  let detail = '';
  try { detail = (await chosen[2]()) || ''; } catch (e) { detail = `(skipped: ${e.message.split('\n')[0].slice(0, 80)})`; }
  log.push(`${step}. ${chosen[1]} ${detail}`.trim());
  await page.waitForTimeout(int(20, 120));
  // Wandered off-site? Go back home.
  try { if (new URL(page.url()).origin !== start.origin) { log.push(`${step}. (left origin -> back to start)`); await page.goto(start.href, { waitUntil: 'domcontentloaded' }); } } catch { /* about:blank etc. */ }
}

// Final health check: is the page still alive and rendering something?
const bodyText = await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => -1);
if (bodyText === 0) finding('medium', 'blank-page', 'the page ended up blank (white screen)');

await browser.close();
const order = { critical: 0, high: 1, medium: 2, low: 3 };
findings.sort((a, b) => order[a.severity] - order[b.severity]);
const result = { tool: 'bongo/ui_monkey', url: start.href, seed: SEED, actions: Math.min(step - 1, ACTIONS), findings };
writeFileSync(join(OUT, 'bongo-ui-report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.error(findings.length
  ? `🍌 Bongo found ${findings.length} distinct issue(s). Screenshots and the report are in ${OUT}. Replay with --seed ${SEED}.`
  : `💪 ${result.actions} chaos actions, nothing broke. Bongo is sulking.`);
process.exit(findings.length ? 1 : 0);

// --- helpers ---
async function candidates(kind) {
  return page.evaluate(({ kind, destructive, reckless }) => {
    const re = new RegExp(destructive, 'i');
    const sel = {
      click: 'a[href], button, input[type=submit], input[type=button], input[type=checkbox], input[type=radio], [role=button], [role=tab], [role=menuitem], [role=link], summary, label, [onclick], [tabindex]:not([tabindex="-1"])',
      type: 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=file]):not([type=range]):not([type=color]), textarea, [contenteditable=""], [contenteditable=true]',
      select: 'select',
    }[kind];
    const out = [];
    // Fresh ids per query, prefixed by kind, so stale or cross-kind tags never collide
    document.querySelectorAll(`[data-bongo^="${kind}-"]`).forEach((el) => el.removeAttribute('data-bongo'));
    document.querySelectorAll(sel).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || style.visibility === 'hidden' || style.display === 'none') return;
      const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('name') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const href = el.getAttribute('href') || '';
      if (!reckless && (re.test(label) || re.test(href) || re.test(el.id || '') || re.test(el.className?.toString?.() || ''))) return;
      if (/^(mailto:|tel:|javascript:)/i.test(href) || el.hasAttribute('download')) return;
      el.setAttribute('data-bongo', `${kind}-${i}`);
      out.push({ id: `${kind}-${i}`, tag: el.tagName.toLowerCase(), label });
    });
    return out;
  }, { kind, destructive: DESTRUCTIVE.source, reckless: !!args.reckless });
}

async function clickSomething({ double = false } = {}) {
  const list = await candidates('click');
  if (!list.length) return '(nothing clickable)';
  const c = pick(list);
  const loc = page.locator(`[data-bongo="${c.id}"]`).first();
  if (double) await loc.dblclick({ timeout: 1500 }); else await loc.click({ timeout: 1500 });
  return `<${c.tag}> "${c.label}"`;
}

async function typeSomething() {
  const list = await candidates('type');
  if (!list.length) return '(no inputs)';
  const c = pick(list);
  const text = pick(CHAOS_TEXT);
  const loc = page.locator(`[data-bongo="${c.id}"]`).first();
  await loc.fill(text, { timeout: 1500 }).catch(async () => { await loc.click({ timeout: 1000 }); await page.keyboard.type(text.slice(0, 200)); });
  if (rng() < 0.4) await loc.press('Enter', { timeout: 1000 }).catch(() => {});
  return `<${c.tag}> "${c.label}" <- ${JSON.stringify(text.length > 40 ? text.slice(0, 40) + `…(${text.length} chars)` : text)}`;
}

// Fill every visible field with chaos, then press a button: the classic
// "user pasted garbage everywhere and hit submit".
async function formBlitz() {
  const inputs = await candidates('type');
  if (!inputs.length) return '(no inputs)';
  const text = pick(CHAOS_TEXT);
  for (const c of inputs.slice(0, 20)) await page.locator(`[data-bongo="${c.id}"]`).first().fill(text, { timeout: 1000 }).catch(() => {});
  const buttons = (await candidates('click')).filter((c) => c.tag === 'button' || c.tag === 'input');
  const b = buttons.length ? pick(buttons) : null;
  if (b) await page.locator(`[data-bongo="${b.id}"]`).first().click({ timeout: 1500 });
  else await page.keyboard.press('Enter');
  return `${inputs.length} field(s) <- ${JSON.stringify(text.length > 40 ? text.slice(0, 40) + '…' : text)}, then ${b ? `<${b.tag}> "${b.label}"` : 'Enter'}`;
}

async function selectSomething() {
  const list = await candidates('select');
  if (!list.length) return '(no selects)';
  const c = pick(list);
  const loc = page.locator(`[data-bongo="${c.id}"]`).first();
  const values = await loc.evaluate((s) => [...s.options].map((o) => o.value));
  if (!values.length) return '(empty select)';
  const v = pick(values);
  await loc.selectOption(v, { timeout: 1500 });
  return `<select> "${c.label}" = ${JSON.stringify(v)}`;
}

function finding(severity, kind, message, stack) {
  const sig = `${kind}|${message.replace(/\d+/g, 'N').slice(0, 120)}`;
  if (seen.has(sig)) { const f = findings.find((x) => x.signature === sig); if (f) f.occurrences++; return; }
  seen.add(sig);
  const f = { severity, kind, message, signature: sig, occurrences: 1, step, url: safeUrl(), reproSteps: log.slice(-12), stack: stack?.split('\n').slice(0, 6).join('\n') };
  findings.push(f);
  const shot = join(OUT, `bongo-ui-${findings.length}-${kind}.png`);
  page.screenshot({ path: shot }).then(() => { f.screenshot = shot; }, () => {});
}
function safeUrl() { try { return page.url(); } catch { return null; } }
function trimUrl(u) { return u.length > 120 ? u.slice(0, 120) + '…' : u; }
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
    o[k] = eq > 0 ? a.slice(eq + 1) : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return o;
}
