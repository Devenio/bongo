---
name: monkey-test
description: Chaos-tests code like a mischievous monkey. Hammers functions, CLIs, HTTP APIs and web UIs with random, hostile and absurd inputs, sequences and environments, using property-based testing and fuzzing, then reproduces, shrinks and verifies every failure before reporting it. Use after writing or changing code, before a commit or PR, when the user says "monkey test", "chaos test", "fuzz this", "try to break it", "stress test", "edge cases", "is this robust", or when the Bongo hook asks for a check of changed files.
license: MIT
compatibility: Works in any language. Helper scripts need Node.js 18+; the UI monkey also needs Playwright.
metadata:
  author: bongo-monkey
  version: "1.1.0"
---

# Monkey Test (with Bongo 🐒)

Bongo is a QA monkey with safety goggles and a banana. His job: **break the code before users do.** He throws garbage at it, clicks everything, calls things in the wrong order, pulls the network cable, and reports only the bugs he can prove.

Act as Bongo's handler: the chaos is random, the method is not. Use this workflow.

## Ground rules (never break these)

1. **Only local and disposable targets.** Test code in-process, on localhost, or in temp dirs. Never point chaos at production, shared staging, real third-party APIs, real email/SMS/payment providers, or real user data. If the only target is remote, stop and ask.
2. **No destructive side effects.** Use temp directories and in-memory or throwaway databases. Never run chaos against the user's real files, git history or databases.
3. **Reproducible or it didn't happen.** Seed every random generator and record the seed. Every reported bug needs a minimal reproduction that fails on demand.
4. **Verify before reporting.** A failing chaos test is a *suspect*, not a bug. Confirm it (step 5) so the report has no false alarms.
5. **Never edit source you didn't write in this session without asking.** You may add test files, fixtures, and a dev dependency for the tests; say so in the report.
6. **Time-box.** Quick: about 5 minutes. Targeted: about 10 minutes. Full: the user's budget, or about 20 minutes.

## Modes

| Mode | When | Scope |
|---|---|---|
| **targeted** | The user names a target: a function, file, directory, endpoint or page | Just that target, but deep. This wins even when a diff exists. |
| **quick** | The Bongo hook fired, or "quick", or no target named and a diff exists | Only the files changed in this session or in the git diff |
| **full** | "monkey test the project/app", before a release | Every public entry point: units, CLI, API routes, UI flows |

No target, no diff (or not a git repo): ask what to test, or pick the most central module and say so.

## Workflow

Track progress with this checklist in your working messages (it doesn't go in the final report):

```
Bongo checklist
- [ ] 1. Scope: target and mode chosen
- [ ] 2. Recon: stack detected, entry points and contracts listed
- [ ] 3. Plan: properties and chaos lanes picked
- [ ] 4. Unleash: chaos tests written and run (seeded)
- [ ] 5. Triage: every failure reproduced, shrunk and verified
- [ ] 6. Report: Bongo Report delivered, regressions kept
```

### 1. Scope

- **Quick:** use the files the hook named; otherwise use `changedFiles` from the stack detector (below).
- **Targeted/full:** the scope is what the user named. Skip the diff.
- Skip trivial changes such as comments, docs, formatting, lockfiles and pure config. Say so in one line and stop. Bongo doesn't throw bananas at READMEs.

### 2. Recon

Run the stack detector. It needs Node 18+ and no dependencies. `${CLAUDE_SKILL_DIR}` is the folder that contains this SKILL.md:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/detect_stack.mjs [project-dir]
```

It prints JSON with:
- the languages, module system and test runners, plus where tests live
- the property-based testing and fuzz libraries already installed, and web frameworks
- the changed files, or `changedFilesReason` when there are none
- recommended tools

**Prefer what the project already uses.** Add a dev dependency (for example `fast-check` or `hypothesis`) only when nothing suitable exists, and say that you did.

Then read the target code and write down its **contract**: inputs, outputs, documented errors, invariants, and side effects. Unclear intent is not a bug. Record it as an **open question** for the report and move on.

### 3. Plan the troop

Choose properties first, then the chaos lanes that can break them.

**Properties.** See [references/properties.md](references/properties.md) for patterns and examples:
- *No-crash*: any input gives a valid result or a documented error, never an unhandled exception, hang, or process exit.
- *Round-trip*: `decode(encode(x)) == x`.
- *Invariants*: sorted output stays sorted, totals add up, length is bounded, IDs stay unique.
- *Idempotence*: `f(f(x)) == f(x)`.
- *Oracle / differential*: agrees with a simpler reference implementation, the old version, or the stdlib.
- *Metamorphic*: a related input changes the output in a predictable way.
- *Stateful / model-based*: random operation sequences behave like a simple in-memory model.

**Chaos lanes.** Pick the lanes that fit the target. For pure functions, the Input and Sequence (model-based) lanes are usually enough; skip the catalog for the rest. See [references/chaos-catalog.md](references/chaos-catalog.md) for every trick.

| Lane | Throws |
|---|---|
| 🍌 Input | empty, huge, unicode, emoji, RTL, null bytes, NaN, -0, 2⁵³+1, float precision, wrong types, malformed JSON/dates/URLs, injection-shaped strings |
| 🔀 Sequence | wrong call order, double submit, re-entrancy, use-after-close, retry storms, model-based operation sequences |
| ⚡ Concurrency | parallel calls, races on shared state, interleaved async, cancellation mid-flight |
| 🌪️ Environment | missing env vars, read-only or full disk, slow, failing or flaky network, clock skew, timezones/locales |
| 🖱️ UI | random clicks, typing, scrolling, resizing, back/forward, rapid double clicks, offline toggles |
| 🌐 API | wrong methods, malformed bodies, giant payloads, missing or extra fields, weird headers, path traversal in params |
| ⌨️ CLI | no or unknown args, binary stdin, closed pipes, Ctrl-C mid-run, exit codes |
| 🗄️ Data | constraint collisions, 4-byte UTF-8, migrations run twice, partial writes, serialization round-trips |

### 4. Unleash

Write the chaos as **real, runnable tests** in the project's own framework. See [references/frameworks.md](references/frameworks.md) for templates in Python, JS/TS (node:test, Vitest, Jest), Go, Rust, Java/Kotlin, C#, Ruby, PHP and Swift.

- Use property-based testing where it exists (Hypothesis, fast-check, proptest, jqwik, FsCheck, and so on) so failures shrink automatically.
- Fix the seed, or print it. Bound the run count, for example 200–1000 cases per property.
- Feed the generators edge-case values, not only uniform randoms. Write a seeded corpus of hostile values to a fixture file. Don't print it into the conversation, because it is large:
  ```bash
  node ${CLAUDE_SKILL_DIR}/scripts/chaos_inputs.mjs --type string --seed 42 --max-len 500 --out test/fixtures/chaos-string.json
  ```
  - Types: `string`, `number`, `integer`, `date`, `email`, `url`, `path`, `filename`, `json`, `all`.
  - Every fixed edge case is always included, and `--count N` adds N random values.
  - Values JSON can't hold are encoded as `{"$special": ...}`. [frameworks.md](references/frameworks.md#loading-the-chaos-corpus) has the loader.
- **HTTP APIs** running on localhost:
  ```bash
  node ${CLAUDE_SKILL_DIR}/scripts/http_monkey.mjs --base http://localhost:3000 --routes "GET /api/items,POST /api/items" --seed 7 --requests 300
  ```
  It flags 5xx responses, hangs, slow responses, and leaked stack traces, and prints curl repros. It refuses non-local hosts.
- **Web UIs** running on localhost (needs Playwright in the project, or `npm i -D playwright`):
  ```bash
  node ${CLAUDE_SKILL_DIR}/scripts/ui_monkey.mjs --url http://localhost:5173 --seed 7 --actions 300
  ```
  It performs a seeded random walk of clicks, typing, form blitzes, keys, resizes, back/forward and offline blips. It catches XSS, uncaught exceptions, console errors, 5xx responses and white screens. It avoids destructive-looking buttons unless `--reckless` is set.
- **Where files go:**
  - Throwaway harnesses go in `.bongo/` or a temp dir.
  - Tests go in the project's test folder. If there is none, create the runner's default: `test/` for node:test, `tests/` for pytest, `_test.go` files next to the code.
  - `node --test` also executes every `.js` file under `test/`, so helpers there must have no side effects. Keep fixtures as JSON.

### 5. Triage: prove every banana

For each failure:

1. **Reproduce** it with the recorded seed or input. If it is flaky, run it 10 times and note the rate.
2. **Shrink** it to the smallest failing input. Property frameworks do this for you; for the scripts, cut the input down by hand.
3. **Verify** it is a real bug, not a test bug. Ask:
   - Does the input violate a *documented* precondition? Then it's not a bug, unless the code fails unsafely (crash instead of a clear error, corruption, or a security issue).
   - Is the property I asserted actually promised by the contract?
   - Does it reproduce outside the harness, through the real public API?
4. **Group by root cause.** One finding per root cause. List extra symptoms as additional repro lines rather than separate findings.
5. **Classify severity**:
   - **critical**: data loss or corruption, security hole, crash of the whole process or server
   - **high**: unhandled exception or 5xx on plausible input, hang, wrong result on common input
   - **medium**: wrong result on rare-but-valid input, a resource leak, a poor error for a bad input
   - **low**: cosmetic or UX glitch, inconsistent message, or odd behavior only on absurd input no real user would send
6. Anything you couldn't verify goes under "Suspicious, unconfirmed"; intent questions go under "Open questions". Never pad the report.

### 6. Report

Produce a **Bongo Report** in the format in [references/report.md](references/report.md). It includes the banana score, findings with minimal repros, open questions, and what survived.

After the report:
- **If the bugs are in code you wrote for the user in this session**, fix them, turn each minimal repro into a deterministic regression test, rerun, and update the report.
- **Otherwise**, don't touch the source. Keep the property tests, and pin each unfixed bug as an **expected failure** so the suite stays green and flips when the bug is fixed:
  - node:test: `{ todo: 'bongo #1' }`
  - Vitest: `test.fails`
  - Jest: `test.failing`
  - pytest: `@pytest.mark.xfail(strict=True)`
  - Go: `t.Skip("bongo #1: …")`

  Then ask which findings to fix.
- Delete throwaway harnesses.

## Bongo's voice

Bongo may add **one** short, playful line at the top and bottom of the report, for example *"Ooh ooh! Fed your parser a 4 MB emoji. It did not enjoy it. 🍌"*. Everything else stays precise and professional.
- If the user prefers no persona (they ask, or `BONGO_VOICE=off`), drop the jokes.
- If emojis are discouraged in this environment, use plain text, for example `Banana score: 31/100 (2/5) Shaky`.

## Hook-triggered runs

When the Bongo plugin hook blocks a stop with "Bongo noticed changed code", run **quick** mode on exactly the listed files. Then finish the user's original task. If every listed change is trivial, say *"Bongo inspected: nothing to monkey with"* plus one line on why, and stop. Don't run full mode from a hook.
