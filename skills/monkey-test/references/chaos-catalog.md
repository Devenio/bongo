# Chaos catalog

Bongo's tricks, grouped by lane. Pick what fits the target. You don't need all of them: one sharp, well-chosen trick beats fifty random ones.

## Contents
- [Input chaos](#input-chaos)
- [Sequence and state chaos](#sequence-and-state-chaos)
- [Concurrency chaos](#concurrency-chaos)
- [Environment chaos](#environment-chaos)
- [UI chaos](#ui-chaos)
- [API chaos](#api-chaos)
- [CLI chaos](#cli-chaos)
- [Data and persistence chaos](#data-and-persistence-chaos)
- [What to watch for](#what-to-watch-for)

## Input chaos

**Strings**
- `""`, `" "`, `"\t\n"`, a single char, a 1 MB string, a 10 MB string (only if the input is meant to be unbounded)
- Unicode: `"é"` precomposed vs `"é"` combining, emoji `"👩‍👩‍👧‍👦"` (ZWJ sequence, 1 glyph, 11 code units), flags `"🇮🇷"`, RTL `"مرحبا"`, mixed bidi with `"‮"`, zero-width `"​"`, BOM `"﻿"`, lone surrogates `"\uD800"`
- Control chars: `"\0"`, `"\x1b[31m"` (ANSI), `"\r\n"` vs `"\n"`, form feed
- Case traps: `"ß".upper()`, Turkish `"İ"`/`"ı"`, `"ǅ"`
- Injection-shaped (look for *handling*, not exploitation): `"' OR 1=1 --"`, `"<script>alert(1)</script>"`, `"{{7*7}}"`, `"${jndi:x}"`, `"; rm -rf /"` (never execute!), `"../../etc/passwd"`, `"%00"`, `"%2e%2e%2f"`
- Format strings: `"%s%s%n"`, `"{0}"`, `"%(x)s"`
- Look-alikes: the string `"null"`, `"undefined"`, `"NaN"`, `"true"`, `"0"`, `"-0"`, `"1e309"`, `"0x10"`, `"010"`

**Numbers**
- `0`, `-0`, `1`, `-1`, `NaN`, `±Infinity`
- Integer boundaries: 2³¹−1, −2³¹, 2³², 2⁵³ and 2⁵³+1 (where JS loses precision), 2⁶³−1, u64 max
- Floats: `0.1 + 0.2`, `1e-308`, `5e-324` (subnormal), `1.7976931348623157e308`
- Money and precision: `0.005` rounding, negative amounts, amounts with 3+ decimals
- Off-by-one: length − 1, length, length + 1, and the exact limit vs. limit ± 1

**Collections**
- empty, a single element, duplicates, already sorted, reverse sorted, all-equal elements, 100k elements
- nested 1,000 levels deep (recursion limits), cyclic references (serializers)
- mutating a collection while iterating it, sparse arrays, holes

**Structured text**
- JSON: trailing commas, duplicate keys, `__proto__` / `constructor` keys (prototype pollution), huge numbers, deep nesting, a BOM prefix, a top-level scalar
- Dates: Feb 29 on leap and non-leap years, Dec 31 → Jan 1, DST gaps (02:30 on a spring-forward day), year 0, 1970-01-01, 2038-01-19T03:14:08Z, 9999-12-31, timezone offsets of ±14:00, `"2024-13-45"`
- URLs: no scheme, `javascript:`, IDN `xn--`, user:pass@host, IPv6 `[::1]`, a port of 0 or 99999, a fragment-only URL, double slashes
- Emails: `"a@b"`, quoted local parts, `+tags`, uppercase, 254+ characters, unicode domains
- Paths and filenames: spaces, `CON`/`NUL`/`AUX` (Windows), a trailing dot, 260+ characters, symlink loops, a relative `..`, unicode normalization (macOS NFD)

**Type confusion** (dynamic languages and API boundaries)
- string where number expected, `null`/`None`/`undefined`, an array instead of an object, a boolean as a string, extra fields, missing required fields, wrong nesting

## Sequence and state chaos

- Call before init, call after close/dispose, close twice, init twice
- Double submit: the same action twice within 1 ms
- Out-of-order events: "update" before "create", "ack" before "send"
- Interrupted flows: crash or throw halfway, then resume or retry
- Re-entrancy: a callback that calls back into the same object
- Retry storms: the same idempotency key 50 times
- Undo/redo past the ends of history, pagination past the last page, cursor reuse
- Cache: stale reads after writes, cache key collisions, eviction during use
- **Model-based**: generate random sequences of operations (add, remove, get, clear, and so on) and compare against a trivially correct model such as a plain dict or list

## Concurrency chaos

- N parallel calls to the same function sharing state (counters, maps, files)
- Read-modify-write races: two increments, check-then-act
- Async: resolve promises in random order, cancel/abort mid-flight, timeouts that fire just as the result arrives
- Locks: acquire in different orders (deadlock), forget to release on an error path
- Event loops: block the loop and verify the timeouts still behave

## Environment chaos

Simulate with mocks, fakes, temp dirs or env overrides. Never break the real machine.

- Missing, empty or malformed env vars and config files
- File system: missing dir, read-only dir, file deleted between check and open, disk full (mock `ENOSPC`), a permission denied error, a very long path
- Network (mocked or a local fake server): timeout, connection reset, DNS failure, a 500, a 429 with `Retry-After`, a slow trickle response, a truncated body, invalid JSON from the upstream, a redirect loop
- Clock: frozen time, a backward jump (NTP), the end of a month, leap seconds, a timezone change at runtime, `TZ=Pacific/Kiritimati`, `TZ=America/St_Johns`
- Locale: `LANG=tr_TR` (case mapping), comma decimal separators `de_DE`, RTL locales
- Resources: low memory limits, a tiny max file descriptor count, a slow CPU (add delays)

## UI chaos

Use `scripts/ui_monkey.mjs` for a random walk, then target what it finds.

- Random clicks everywhere, including disabled-looking and overlapping elements
- Double and triple clicks on submit buttons
- Type hostile strings (see Input chaos) into every input, then submit
- Paste 100k characters, then clear
- Resize to 320×480, then 2560×1440, mid-interaction
- Back/forward/reload in the middle of a multi-step flow
- Toggle offline during a request (`context.setOffline(true)`)
- Rapid route changes before data loads (race between responses)
- Keyboard-only navigation: Tab, Enter, Escape, Space on everything
- Open the same flow in two tabs

## API chaos

Use `scripts/http_monkey.mjs` for a broad sweep.

- Wrong method on each route (`DELETE` on a GET route, and so on), `OPTIONS`, `HEAD`
- Bodies: none, empty `{}`, `[]`, `null`, invalid JSON, a 5 MB body, deeply nested JSON, wrong `Content-Type`, a charset mismatch
- Fields: missing required, extra unknown, wrong types, boundary values, a negative quantity, an ID that doesn't exist, another user's ID (authorization check)
- Headers: a missing or garbage `Authorization`, a huge header, duplicate headers, a weird `Accept`
- Params: path traversal `..%2f`, encoded slashes, unicode, very long IDs, `?page=-1&limit=1e9`
- Repeat a POST quickly (idempotency), send many concurrent writes to the same resource

**Expected:** a 4xx with a clear message. **Bug:** any 5xx, a hang, a stack trace or internal path in the response, data changed after a rejected request, or a 200 on invalid input that should fail.

## CLI chaos

- No args, `--help`, unknown flags, repeated flags, `--flag=` with an empty value
- Huge or binary stdin, closed stdin, stdout to a closed pipe (`| head -1`)
- Non-existent, unreadable, directory-instead-of-file and unicode filename args
- Ctrl-C mid-run: are temp files cleaned up and is the state left consistent?
- Exit codes: non-zero on failure, zero on success

## Data and persistence chaos

Throwaway DB or in-memory only.

- Unique constraint collisions, null in not-null columns via the API layer
- Very long text, emoji in every text column (4-byte UTF-8 in MySQL `utf8` vs `utf8mb4`)
- Migrations: run twice, run on an empty DB, run on a DB with odd legacy rows
- Transactions: failure halfway, so check for partial writes
- Serialization: save, load and compare all fields (round-trip), especially dates, decimals and enums

## What to watch for

A trick only matters if you **observe** something. Assert on:

- Exceptions or panics escaping the public API
- Hangs: always wrap in a timeout
- Wrong results that violate a property
- Silent corruption: the state after the operation fails an invariant
- Resource leaks: open handles, listeners or memory growing across iterations
- Security smells: an unescaped echo of input, a stack trace in the response, a path outside the sandbox
- Slowness: an input that makes runtime explode (catastrophic regex backtracking, O(n²) on 100k items)
