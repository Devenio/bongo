# Framework templates

Use the project's existing tools first. These templates show the idiomatic shape: a seeded, bounded run with shrinking. Adapt the names. Check the installed library version, because APIs drift between major versions.

## Contents
- [Python: Hypothesis](#python-hypothesis)
- [Loading the chaos corpus](#loading-the-chaos-corpus)
- [JavaScript / TypeScript: fast-check](#javascript--typescript-fast-check)
- [Go: native fuzzing and rapid](#go-native-fuzzing-and-rapid)
- [Rust: proptest and cargo-fuzz](#rust-proptest-and-cargo-fuzz)
- [Java / Kotlin: jqwik and Kotest](#java--kotlin-jqwik-and-kotest)
- [C# / .NET: FsCheck or CsCheck](#c--net-fscheck-or-cscheck)
- [Ruby, PHP, Swift](#ruby-php-swift)
- [No library? Seeded loop fallback](#no-library-seeded-loop-fallback)
- [Web UI and HTTP](#web-ui-and-http)

## Python: Hypothesis

Install with `pip install hypothesis`. Run with `pytest -q tests/test_bongo_*.py --hypothesis-seed=42`.

```python
from hypothesis import given, settings, strategies as st, HealthCheck

CHAOS = ["", " ", "\x00", "👩‍👩‍👧‍👦", "‮", "İ", "' OR 1=1 --", "../../etc/passwd", "9" * 400]

@settings(max_examples=500, deadline=1000, suppress_health_check=[HealthCheck.too_slow])
@given(st.one_of(st.sampled_from(CHAOS), st.text()))
def test_normalize_never_crashes_and_is_idempotent(s):
    out = normalize(s)                    # no-crash
    assert normalize(out) == out          # idempotence
    assert all(c.isalnum() or c == "-" for c in out)

@given(st.dictionaries(st.text(), st.integers() | st.floats(allow_nan=False) | st.text()))
def test_roundtrip(d):
    assert load(dump(d)) == d
```

Stateful, model-based testing:

```python
from hypothesis.stateful import RuleBasedStateMachine, rule, invariant

class InventoryMachine(RuleBasedStateMachine):
    def __init__(self):
        super().__init__()
        self.inv, self.model = Inventory(), {}

    @rule(sku=st.sampled_from(["a", "b", "c"]), qty=st.integers(-3, 5))
    def add(self, sku, qty):
        try:
            self.inv.add(sku, qty)
            self.model[sku] = self.model.get(sku, 0) + qty
        except ValueError:
            assert qty <= 0  # rejecting is only OK for non-positive quantities

    @rule(sku=st.sampled_from(["a", "b", "c"]))
    def remove(self, sku):
        self.inv.remove(sku); self.model.pop(sku, None)

    @invariant()
    def matches_model(self):
        assert self.inv.items() == self.model

TestInventory = InventoryMachine.TestCase
```

## Loading the chaos corpus

`chaos_inputs.mjs` writes `{ seed, type, values }`. Values JSON can't represent are encoded as:
- `{"$special": "NaN" | "Infinity" | "-Infinity" | "-0"}`
- `{"$special": "bigint", "value": "9223372036854775807"}`
- `{"$special": "unsafe-int", "value": "9007199254740993"}`: an integer beyond 2^53. As a JS number it rounds, so it is kept as a string; use it where the target parses text.

JS loader. Save it as `test/bongo-corpus.js`. Note that `node --test` also executes every `.js` file under `test/`; that's harmless for a module like this one, which has no top-level side effects:

```js
import { readFileSync } from 'node:fs';
export function loadCorpus(file) {
  const revive = (k, v) => {
    if (!v || typeof v !== 'object' || !('$special' in v)) return v;
    if (v.$special === 'bigint') return BigInt(v.value);
    if (v.$special === 'unsafe-int') return v.value;
    return Number(v.$special); // NaN, Infinity, -Infinity, -0
  };
  return JSON.parse(readFileSync(file, 'utf8'), revive).values;
}
```

Python: `values = json.load(f, object_hook=lambda d: float(d["$special"]) if d.get("$special") in ("NaN", "Infinity", "-Infinity", "-0") else int(d["value"]) if "$special" in d else d)["values"]`.

## JavaScript / TypeScript: fast-check

Install with `npm i -D fast-check`. It works with `node:test`, Vitest, Jest and Mocha.

**node:test** (zero config, Node 18+). Save as `test/bongo.parser.test.js` and run `node --test`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { loadCorpus } from './bongo-corpus.js'; // see "Loading the chaos corpus"
import { parse, format } from '../src/parser.js';

const corpus = loadCorpus(new URL('./fixtures/chaos-string.json', import.meta.url));
const anyInput = fc.oneof(fc.constantFrom(...corpus), fc.string(), fc.anything());

test('parse never throws an undocumented error', () => {
  fc.assert(fc.property(anyInput, (s) => {
    try { parse(s); } catch (e) { assert.ok(e instanceof ParseError, `unexpected ${e}`); }
  }), { numRuns: 1000, seed: 42 });
});

// A confirmed but unfixed bug, pinned so CI stays green until it's fixed:
test('bongo #1: parse rejects "1.5h"', { todo: 'bongo #1' }, () => {
  assert.throws(() => parse('1.5h'));
});
```

**Vitest / Jest:**

```ts
import fc from 'fast-check';
import { test, expect } from 'vitest';

const chaos = fc.constantFrom('', ' ', '\u0000', '👩‍👩‍👧‍👦', '‮', '__proto__', '{"a":', 'NaN', '-0');
const anyString = fc.oneof(chaos, fc.string(), fc.string({ unit: 'grapheme' })); // v4; on v3 use fc.fullUnicodeString()

test('parse never throws unexpectedly', () => {
  fc.assert(
    fc.property(anyString, (s) => {
      try { parse(s); }
      catch (e) { expect(e).toBeInstanceOf(ParseError); } // only the documented error type
    }),
    { numRuns: 1000, seed: 42 },
  );
});

test('format/parse round-trip', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 10 ** 9 }), (ms) => {
    expect(parse(format(ms))).toBe(ms);
  }), { seed: 42 });
});

test('handler survives anything JSON-ish', async () => {
  await fc.assert(fc.asyncProperty(fc.anything(), async (body) => {
    const res = await handler({ body });
    expect(res.status).toBeLessThan(500);
  }), { numRuns: 300, seed: 42 });
});
```

For model-based testing, use `fc.commands([...])` with `fc.modelRun(setup, cmds)`. Each command class implements `check(model)`, `run(model, real)` and `toString()`.

React and DOM components: render with Testing Library, then drive random `fireEvent`/`userEvent` sequences generated by `fc.array(fc.constantFrom(...actions))`.

## Go: native fuzzing and rapid

Native fuzzing needs Go 1.18+. Run with `go test -run=^$ -fuzz=FuzzParse -fuzztime=30s ./pkg/...`. Failing inputs are saved in `testdata/fuzz/` and become regression tests automatically.

```go
func FuzzParse(f *testing.F) {
    for _, s := range []string{"", "1h", "-0s", "9999999999999h", "1h\x00", "١٢h"} {
        f.Add(s)
    }
    f.Fuzz(func(t *testing.T, s string) {
        d, err := Parse(s)
        if err != nil {
            return // documented error is fine
        }
        if got, err := Parse(Format(d)); err != nil || got != d {
            t.Fatalf("round-trip %q -> %v -> %q -> %v (%v)", s, d, Format(d), got, err)
        }
    })
}
```

For structured or property-style tests, use `pgregory.net/rapid`, for example `rapid.Check(t, func(t *rapid.T) { n := rapid.IntRange(-1e6, 1e6).Draw(t, "n"); ... })`. It also supports state machines through `t.Repeat(map[string]func(*rapid.T){...})`.

## Rust: proptest and cargo-fuzz

```rust
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(500))]

    #[test]
    fn roundtrip(s in "\\PC*") {                 // any printable unicode
        prop_assert_eq!(decode(&encode(&s)).unwrap(), s);
    }

    #[test]
    fn never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..4096)) {
        let _ = parse(&bytes);                  // panics fail the test
    }
}
```

For fuzzing with libFuzzer, run `cargo install cargo-fuzz && cargo fuzz init`, then `cargo +nightly fuzz run parse -- -max_total_time=30`.

## Java / Kotlin: jqwik and Kotest

jqwik runs on JUnit 5:

```java
@Property(tries = 500, seed = "42")
void neverThrowsUnexpected(@ForAll @StringLength(max = 2000) String s) {
    try { Parser.parse(s); } catch (ParseException expected) { }
}

@Property
boolean roundTrip(@ForAll @IntRange(min = 0) int n) {
    return Codec.decode(Codec.encode(n)) == n;
}
```

Kotest property testing:

```kotlin
class ParserProps : StringSpec({
    "round-trip" {
        checkAll(PropTestConfig(seed = 42), Arb.string(0..200, Codepoint.az())) { s ->
            decode(encode(s)) shouldBe s
        }
    }
})
```

## C# / .NET: FsCheck or CsCheck

FsCheck with xUnit:

```csharp
[Property(MaxTest = 500, Replay = "42,0")]
public bool RoundTrip(NonNull<string> s) => Codec.Decode(Codec.Encode(s.Get)) == s.Get;
```

CsCheck:

```csharp
Gen.String.Sample(s => Codec.Decode(Codec.Encode(s)) == s, iter: 500, seed: "0N0XIzNsQ0O2");
```

## Ruby, PHP, Swift

- **Ruby**: the `prop_check` gem (`PropCheck.forall(PropCheck::Generators.printable_string) { |s| ... }`), or the seeded loop fallback below.
- **PHP**: Eris on PHPUnit (`use Eris\TestTrait;`, then `$this->forAll(Generators::string())->then(fn($s) => ...)`).
- **Swift**: SwiftCheck (`property("round-trip") <- forAll { (s: String) in decode(encode(s)) == s }`).

## No library? Seeded loop fallback

This works in any language and needs no dependencies. You get no automatic shrinking, so shrink by hand.

```
seed = 42; rng = Random(seed)
corpus = <output of: node ${CLAUDE_SKILL_DIR}/scripts/chaos_inputs.mjs --type all --seed 42>
for i in 0..1000:
    x = corpus[i] if i < len(corpus) else random_value(rng)
    try: check_property(x)
    except Exception as e: print(f"FAIL seed={seed} i={i} input={x!r}: {e}"); raise
```

## Web UI and HTTP

- **Random UI walk**: `node ${CLAUDE_SKILL_DIR}/scripts/ui_monkey.mjs --url http://localhost:PORT --seed N`. Replay any failure with the same seed.
- **Targeted UI chaos**: write a Playwright test that loops seeded random actions over a known form or flow, and assert there are no `pageerror` events or console errors.
- **gremlins.js** is a classic in-browser monkey. Inject it with Playwright `page.addScriptTag` if the project already uses it.
- **HTTP**: `node ${CLAUDE_SKILL_DIR}/scripts/http_monkey.mjs --base http://localhost:PORT --routes "..."`. With an OpenAPI spec, consider Schemathesis (`schemathesis run openapi.yaml --url http://localhost:PORT`) if Python is available.
