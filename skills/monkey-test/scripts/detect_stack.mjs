#!/usr/bin/env node
// Bongo's recon: sniff a project's languages, test runners, property/fuzz
// libraries, web frameworks and changed files, then recommend chaos tools.
//
//   node detect_stack.mjs [project-dir]
//
// Prints JSON. Read-only: never installs or runs anything except `git`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(process.argv[2] || '.');
if (!existsSync(root)) {
  console.error(`No such directory: ${root}`);
  process.exit(2);
}

const read = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } };
const has = (f) => existsSync(join(root, f));

const out = {
  root,
  languages: [],
  testRunners: [],
  propertyLibs: [],
  webFrameworks: [],
  hasUI: false,
  hasHttpApi: false,
  devServerHint: null,
  moduleType: null,
  entryPoints: [],
  testLocations: [],
  changedFiles: [],
  changedFilesReason: null,
  recommendations: [],
};
const add = (k, v) => { if (v && !out[k].includes(v)) out[k].push(v); };

// --- JavaScript / TypeScript ---
const pkgText = read('package.json');
if (pkgText) {
  let pkg = {};
  try { pkg = JSON.parse(pkgText); } catch { /* malformed package.json is itself a finding */ add('recommendations', 'package.json is not valid JSON'); }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  add('languages', has('tsconfig.json') || deps.typescript ? 'typescript' : 'javascript');
  for (const r of ['vitest', 'jest', 'mocha', 'ava', 'tap', '@playwright/test', 'cypress']) if (deps[r]) add('testRunners', r);
  const testScript = pkg.scripts?.test || '';
  if (/node .*--test/.test(testScript) || testFilesMention(/['"]node:test['"]/)) add('testRunners', 'node:test');
  if (/\bbun test\b/.test(testScript)) add('testRunners', 'bun test');
  if (/\bdeno test\b/.test(testScript) || has('deno.json')) add('testRunners', 'deno test');
  out.moduleType = pkg.type === 'module' ? 'esm' : 'commonjs';
  if (pkg.engines?.node) out.nodeEngines = pkg.engines.node;
  const entries = [pkg.main, ...(typeof pkg.exports === 'string' ? [pkg.exports] : Object.values(pkg.exports || {}).flatMap((e) => (typeof e === 'string' ? [e] : Object.values(e || {})))),
    ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {}))];
  for (const e of entries) if (typeof e === 'string') add('entryPoints', e);
  for (const l of ['fast-check', '@fast-check/vitest', '@fast-check/jest', 'jsverify', 'testcheck']) if (deps[l]) add('propertyLibs', l);
  if (deps.playwright || deps['@playwright/test']) add('propertyLibs', 'playwright (ui)');
  if (deps['gremlins.js']) add('propertyLibs', 'gremlins.js');
  const ui = ['react', 'vue', 'svelte', '@sveltejs/kit', 'next', 'nuxt', '@angular/core', 'solid-js', 'astro', 'preact', 'lit', '@remix-run/react'];
  const api = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', 'next', 'nuxt', '@sveltejs/kit', '@remix-run/node', 'h3', 'elysia'];
  for (const f of new Set([...ui, ...api])) if (deps[f]) add('webFrameworks', f);
  if (ui.some((f) => deps[f])) out.hasUI = true;
  if (api.some((f) => deps[f])) out.hasHttpApi = true;
  const s = pkg.scripts || {};
  out.devServerHint = s.dev ? 'npm run dev' : s.start ? 'npm start' : s.serve ? 'npm run serve' : null;
}

// --- Python ---
const py = read('pyproject.toml') + read('requirements.txt') + read('requirements-dev.txt') + read('setup.cfg') + read('Pipfile') + read('setup.py');
if (py || has('manage.py')) {
  add('languages', 'python');
  if (/pytest/i.test(py) || has('pytest.ini') || has('conftest.py')) add('testRunners', 'pytest');
  if (/hypothesis/i.test(py)) add('propertyLibs', 'hypothesis');
  if (/schemathesis/i.test(py)) add('propertyLibs', 'schemathesis');
  if (/atheris/i.test(py)) add('propertyLibs', 'atheris');
  for (const [re, name, isApi, isUi] of [
    [/django/i, 'django', true, true], [/fastapi/i, 'fastapi', true, false], [/flask/i, 'flask', true, true],
    [/starlette/i, 'starlette', true, false], [/aiohttp/i, 'aiohttp', true, false], [/streamlit/i, 'streamlit', false, true],
  ]) if (re.test(py) || (name === 'django' && has('manage.py'))) { add('webFrameworks', name); out.hasHttpApi ||= isApi; out.hasUI ||= isUi; }
}

// --- Go ---
const gomod = read('go.mod');
if (gomod) {
  add('languages', 'go');
  add('testRunners', 'go test');
  add('propertyLibs', 'go native fuzzing');
  if (/pgregory\.net\/rapid/.test(gomod)) add('propertyLibs', 'rapid');
  for (const [re, n] of [[/gin-gonic/, 'gin'], [/labstack\/echo/, 'echo'], [/go-chi/, 'chi'], [/gofiber/, 'fiber'], [/gorilla\/mux/, 'gorilla/mux']]) if (re.test(gomod)) { add('webFrameworks', n); out.hasHttpApi = true; }
}

// --- Rust ---
const cargo = read('Cargo.toml');
if (cargo) {
  add('languages', 'rust');
  add('testRunners', 'cargo test');
  if (/proptest/.test(cargo)) add('propertyLibs', 'proptest');
  if (/quickcheck/.test(cargo)) add('propertyLibs', 'quickcheck');
  if (/arbitrary|libfuzzer/.test(cargo) || has('fuzz/Cargo.toml')) add('propertyLibs', 'cargo-fuzz');
  for (const n of ['axum', 'actix-web', 'rocket', 'warp', 'poem']) if (cargo.includes(n)) { add('webFrameworks', n); out.hasHttpApi = true; }
}

// --- JVM ---
const jvm = read('pom.xml') + read('build.gradle') + read('build.gradle.kts');
if (jvm) {
  add('languages', /kotlin/i.test(jvm) || has('build.gradle.kts') ? 'kotlin/java' : 'java');
  if (/junit/i.test(jvm)) add('testRunners', 'junit');
  if (/kotest/i.test(jvm)) add('testRunners', 'kotest');
  if (/jqwik/i.test(jvm)) add('propertyLibs', 'jqwik');
  if (/kotest-property/i.test(jvm)) add('propertyLibs', 'kotest-property');
  if (/spring-boot/i.test(jvm)) { add('webFrameworks', 'spring-boot'); out.hasHttpApi = true; }
  if (/ktor/i.test(jvm)) { add('webFrameworks', 'ktor'); out.hasHttpApi = true; }
}

// --- .NET ---
const csproj = listTop().filter((f) => /\.(cs|fs)proj$|\.sln$/.test(f)).map(read).join('\n');
if (csproj || listTop().some((f) => f.endsWith('.sln'))) {
  add('languages', 'csharp/.net');
  for (const r of ['xunit', 'nunit', 'MSTest']) if (new RegExp(r, 'i').test(csproj)) add('testRunners', r.toLowerCase());
  for (const l of ['FsCheck', 'CsCheck']) if (csproj.includes(l)) add('propertyLibs', l);
  if (/Microsoft\.AspNetCore|Sdk\.Web/.test(csproj)) { add('webFrameworks', 'aspnetcore'); out.hasHttpApi = true; }
}

// --- Ruby / PHP / Swift / Elixir ---
const gem = read('Gemfile');
if (gem) {
  add('languages', 'ruby');
  if (/rspec/.test(gem)) add('testRunners', 'rspec');
  if (/minitest/.test(gem)) add('testRunners', 'minitest');
  if (/prop_check|rantly/.test(gem)) add('propertyLibs', /prop_check/.test(gem) ? 'prop_check' : 'rantly');
  if (/rails/.test(gem)) { add('webFrameworks', 'rails'); out.hasHttpApi = out.hasUI = true; }
}
const composer = read('composer.json');
if (composer) {
  add('languages', 'php');
  if (/phpunit/.test(composer)) add('testRunners', 'phpunit');
  if (/pest/.test(composer)) add('testRunners', 'pest');
  if (/giorgiosironi\/eris/.test(composer)) add('propertyLibs', 'eris');
  if (/laravel|symfony/.test(composer)) { add('webFrameworks', /laravel/.test(composer) ? 'laravel' : 'symfony'); out.hasHttpApi = true; }
}
if (has('Package.swift')) { add('languages', 'swift'); add('testRunners', 'swift test'); if (/SwiftCheck/.test(read('Package.swift'))) add('propertyLibs', 'SwiftCheck'); }
if (has('mix.exs')) { add('languages', 'elixir'); add('testRunners', 'exunit'); if (/stream_data/.test(read('mix.exs'))) add('propertyLibs', 'stream_data'); }

// Plain static site
if (!out.languages.length && listTop().some((f) => f.endsWith('.html'))) { add('languages', 'html'); out.hasUI = true; }

// OpenAPI specs make API chaos much sharper
const spec = ['openapi.yaml', 'openapi.yml', 'openapi.json', 'swagger.json', 'swagger.yaml', 'docs/openapi.yaml', 'api/openapi.yaml'].find(has);
if (spec) out.openApiSpec = spec;

// Where tests live (create the runner's default if none)
for (const d of ['test', 'tests', '__tests__', 'spec', 'src/test', 'src/__tests__', 'e2e']) if (has(d)) add('testLocations', `${d}/`);

// --- Changed files (quick-mode scope), relative to the project dir ---
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
try {
  git('rev-parse', '--is-inside-work-tree');
  let diff = [];
  try { diff = git('diff', '--name-only', '--relative', 'HEAD').split('\n'); }
  catch { out.changedFilesReason = 'no commits yet: listing untracked files only'; }
  const changed = new Set([...diff, ...git('ls-files', '--others', '--exclude-standard', '--', '.').split('\n')]);
  out.changedFiles = [...changed].filter(Boolean).filter(isCodeFile).slice(0, 200);
  if (!out.changedFiles.length) out.changedFilesReason ||= 'working tree clean: no changed code files';
} catch (e) {
  out.changedFiles = [];
  out.changedFilesReason = e.code === 'ENOENT' ? 'git is not installed' : 'not a git repository';
}

// --- Recommendations ---
const rec = (s) => add('recommendations', s);
const lang = (re) => out.languages.some((l) => re.test(l));
const P = out.propertyLibs.join(' ');
if (lang(/^(typescript|javascript)$/) && !/fast-check/.test(P)) rec('JS/TS: add fast-check as a dev dependency (npm i -D fast-check)');
if (lang(/^python$/) && !/hypothesis/.test(P)) rec('Python: add hypothesis (pip install hypothesis)');
if (lang(/^go$/)) rec('Go: use native fuzzing (func FuzzXxx(f *testing.F)); go test -fuzz=FuzzXxx -fuzztime=30s');
if (lang(/^rust$/) && !/proptest|quickcheck/.test(P)) rec('Rust: add proptest as a dev-dependency');
if (lang(/^(java|kotlin\/java)$/) && !/jqwik|kotest-property/.test(P)) rec('JVM: add jqwik (or kotest-property for Kotlin)');
if (lang(/^csharp/) && !/FsCheck|CsCheck/.test(P)) rec('.NET: add FsCheck.Xunit or CsCheck');
if (out.hasHttpApi) rec(`HTTP API: start it locally${out.devServerHint ? ` (${out.devServerHint})` : ''} and run scripts/http_monkey.mjs${spec ? ` (spec: ${spec})` : ''}`);
if (out.hasUI) rec(`Web UI: start it locally${out.devServerHint ? ` (${out.devServerHint})` : ''} and run scripts/ui_monkey.mjs${/playwright/.test(P) ? '' : ' (needs: npm i -D playwright)'}`);
if (!out.testRunners.length) rec('No test runner found: write chaos harnesses as standalone scripts in .bongo/ and report results');
if (!out.languages.length) rec('Stack not recognized: read the code and use the seeded-loop fallback from references/frameworks.md');

console.log(JSON.stringify(out, null, 2));

// --- helpers ---
// Cheap scan of likely test files for a pattern (bounded, no deps)
function testFilesMention(re) {
  for (const d of ['test', 'tests', '__tests__', 'src']) {
    let files = [];
    try { files = readdirSync(join(root, d)).slice(0, 50); } catch { continue; }
    for (const f of files) {
      if (!/\.(m?js|cjs|ts|mts)$/.test(f)) continue;
      try { if (re.test(readFileSync(join(root, d, f), 'utf8').slice(0, 4000))) return true; } catch { /* unreadable */ }
    }
  }
  return false;
}
function listTop() {
  try { return readdirSync(root).filter((f) => { try { return statSync(join(root, f)).isFile(); } catch { return false; } }); }
  catch { return []; }
}
function isCodeFile(f) {
  const CODE = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.astro', '.py', '.go', '.rs', '.java', '.kt', '.kts', '.scala',
    '.cs', '.fs', '.rb', '.php', '.swift', '.ex', '.exs', '.erl', '.c', '.h', '.cc', '.cpp', '.hpp', '.m', '.mm', '.dart', '.lua', '.sh', '.ps1', '.sql', '.zig', '.clj', '.hs', '.ml', '.r', '.jl']);
  if (/(^|\/)(node_modules|vendor|dist|build|\.next|target|__pycache__|\.venv|venv)\//.test(f)) return false;
  return CODE.has(extname(f).toLowerCase());
}
