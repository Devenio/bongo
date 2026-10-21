#!/usr/bin/env node
// Bongo's leash: makes Claude monkey-test every code change before it finishes.
//
//   track  (PostToolUse on Write|Edit|MultiEdit|NotebookEdit): remember edited code files
//   gate   (Stop): if code changed this turn, block once and ask for a quick monkey test
//
// Modes, from the BONGO_MODE env var or "mode" in <project>/.bongo.json:
//   gate  (default)  block the stop once per batch of changes
//   nudge            never block; remind Claude once per session after the first code edit
//   off              do nothing
// .bongo.json may also hold "ignore": ["docs/**", "*.config.js", ...] (simple globs).
//
// Hooks must never break the session: any internal error exits 0 silently.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, relative, isAbsolute, extname } from 'node:path';
import { tmpdir } from 'node:os';

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.astro', '.py', '.go', '.rs',
  '.java', '.kt', '.kts', '.scala', '.cs', '.fs', '.rb', '.php', '.swift', '.ex', '.exs', '.erl', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.m', '.mm', '.dart', '.lua', '.sh', '.ps1', '.sql', '.zig', '.clj', '.hs', '.ml', '.r', '.jl', '.sol']);
// Tests, Bongo's own harnesses, generated and vendored code don't need a monkey.
const SKIP = /(^|[\\/])(node_modules|vendor|dist|build|out|\.next|target|__pycache__|\.venv|venv|\.bongo|\.claude|tests?|__tests__|specs?|e2e|fixtures?|migrations)[\\/]|\.(test|spec|e2e|stories)\.[a-z]+$|_test\.(go|py|rb|exs)$|(^|[\\/])test_[^\\/]*\.py$|\.d\.ts$|\.min\.js$/i;
const MAX_LISTED = 15;

try {
  const cmd = process.argv[2];
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = loadConfig(projectDir);
  if (config.mode === 'off') process.exit(0);

  const stateDir = join(process.env.CLAUDE_PLUGIN_DATA || join(tmpdir(), 'bongo-claude'), 'sessions');
  const stateFile = join(stateDir, `${String(input.session_id || 'default').replace(/[^\w-]/g, '_')}.json`);
  const state = readJson(stateFile) || { pending: [], nudged: false };

  if (cmd === 'track') track(input, projectDir, config, state, stateDir, stateFile);
  else if (cmd === 'gate') gate(input, config, state, stateDir, stateFile);
} catch {
  // never block the user's session because of Bongo
}
process.exit(0);

function track(input, projectDir, config, state, stateDir, stateFile) {
  const p = input.tool_input?.file_path || input.tool_input?.notebook_path || input.tool_response?.filePath;
  if (!p) return;
  const rel = (isAbsolute(p) ? relative(projectDir, p) : p).split('\\').join('/');
  if (!CODE_EXT.has(extname(rel).toLowerCase()) || SKIP.test(rel) || config.ignore.some((re) => re.test(rel))) return;
  if (!state.pending.includes(rel)) state.pending.push(rel);

  let out = null;
  if (config.mode === 'nudge' && !state.nudged) {
    state.nudged = true;
    out = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: '🐒 Bongo is watching this session. Before you finish, run the monkey-test skill in quick mode on the code you changed (skip it if the changes are trivial).',
      },
    };
  }
  save(stateDir, stateFile, state);
  if (out) process.stdout.write(JSON.stringify(out));
}

function gate(input, config, state, stateDir, stateFile) {
  // Already continuing because of a stop hook: this is Bongo's own run. Its
  // fixes must not re-trigger the gate, so forget them and let Claude stop.
  if (input.stop_hook_active || config.mode !== 'gate' || input.permission_mode === 'plan') {
    if (state.pending.length) { state.pending = []; save(stateDir, stateFile, state); }
    return;
  }
  if (!state.pending.length) return;

  const files = state.pending;
  state.pending = [];
  save(stateDir, stateFile, state);

  const listed = files.slice(0, MAX_LISTED).map((f) => `  - ${f}`).join('\n');
  const more = files.length > MAX_LISTED ? `\n  - …and ${files.length - MAX_LISTED} more` : '';
  const reason = [
    `🐒 Bongo noticed ${files.length} changed code file(s) that haven't been monkey-tested:`,
    listed + more,
    '',
    'Before finishing, use the monkey-test skill in QUICK mode on exactly these changes:',
    'time-box it to about 5 minutes, verify every finding, and keep the Bongo Report short.',
    'If you wrote the bugs in this session, fix them and add regression tests.',
    'If every change is trivial (comments, formatting, renames, config), reply "Bongo inspected: nothing to monkey with" with a one-line reason instead.',
    'Then wrap up your original answer.',
    '(To silence Bongo: set BONGO_MODE=off or put {"mode":"off"} in .bongo.json.)',
  ].join('\n');
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

function loadConfig(projectDir) {
  const file = readJson(join(projectDir, '.bongo.json')) || {};
  const mode = String(process.env.BONGO_MODE || file.mode || 'gate').toLowerCase();
  const ignore = (Array.isArray(file.ignore) ? file.ignore : []).map(globToRegExp);
  return { mode: ['gate', 'nudge', 'off'].includes(mode) ? mode : 'gate', ignore };
}

function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // Globs without a slash match a basename anywhere (like .gitignore)
  return new RegExp(g.includes('/') ? `^${re}$` : `(^|/)${re}$`, 'i');
}

function readJson(f) {
  try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch { return null; }
}

function save(dir, file, state) {
  mkdirSync(dir, { recursive: true });
  if (!state.pending.length && !state.nudged) { rmSync(file, { force: true }); return; }
  writeFileSync(file, JSON.stringify(state));
}
