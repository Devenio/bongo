# Finding properties worth testing

Random inputs are useless without something to check. A **property** is a statement that must hold for *every* valid input. Start from the contract you wrote in Recon, then mine these patterns.

## Contents
- [The seven patterns](#the-seven-patterns)
- [Where properties hide](#where-properties-hide)
- [Writing good generators](#writing-good-generators)
- [Avoiding false alarms](#avoiding-false-alarms)

## The seven patterns

### 1. No-crash (always applies)
For any input the function returns a value or raises a **documented** error. It never throws something unexpected, hangs, or kills the process.
```
for all x: f(x) returns OR raises ValidationError   (within 1s)
```
This is the cheapest property and finds the most bugs. Start here.

### 2. Round-trip
`parse(format(x)) == x`, `decode(encode(x)) == x`, `load(save(x)) == x`, `fromJSON(toJSON(x)) == x`.
Typical bugs: lost precision, lost timezone, escaping errors, unicode normalization, empty vs. null.

### 3. Invariants
Something stays true no matter what:
- `sort(xs)` is ordered, has the same length, and is a permutation of `xs`
- `paginate(items)` pages, concatenated, equal the items with no duplicates
- `balance` never goes negative; `sum(line_items) == total`
- `len(truncate(s, n)) <= n`
- generated IDs are unique

### 4. Idempotence
`f(f(x)) == f(x)`: normalizers, formatters, `slugify`, `trim`, dedupe, migrations, PUT requests, "apply config".

### 5. Oracle / differential
Compare against something trusted:
- a slow but obviously correct implementation (brute force, a naive loop)
- the stdlib or a well-known library (`Date` parsing vs. your custom parser)
- the previous version of the function (refactors!)
- the same function with different but equivalent parameters (sync vs. async, batch vs. one-by-one)

### 6. Metamorphic
You don't know the right answer, but you know how it relates to another answer:
- `search(q)` results ⊇ `search(q + " extra filter")` results
- `price(qty * 2) == 2 * price(qty)` (if pricing is linear)
- shuffling input order doesn't change `sum`, `max`, or a set-based result
- adding whitespace or case changes doesn't change a case-insensitive lookup

### 7. Stateful / model-based
Generate random **sequences of operations** and run them both on the real system and on a tiny model such as a dict, list or counter. After every step, assert that the observable state matches. This catches order-dependent bugs that unit tests never think of.
- Hypothesis: `RuleBasedStateMachine`
- fast-check: `fc.commands` + `fc.modelRun`
- proptest: `proptest-state-machine`
- jqwik: `@Property` with `ActionChain`

## Where properties hide

- **Docstrings and comments**: "returns a sorted list", "never negative", "idempotent"
- **Type signatures**: `Option` / `nullable` return types imply which inputs give none
- **Validation code**: whatever it rejects, everything else must be accepted without crashing
- **Existing example tests**: generalize `assert f(3) == 9` to `f(x) == x*x` for all x
- **Inverse functions** in the same module: `serialize` and `deserialize`, `add` and `remove`
- **README and API docs**: the documented status codes are the *only* allowed ones
- **Bug history**: `git log --grep fix` shows where this code broke before

## Writing good generators

- **Constrain to valid inputs** for correctness properties. Use *unconstrained* inputs for no-crash properties.
- **Mix in edge cases** from `scripts/chaos_inputs.mjs` (for example `fc.oneof(fc.constantFrom(...corpus), fc.string())`).
- **Build objects from parts** (`fc.record`, `st.builds`) rather than filtering random blobs. Heavy filtering makes the generator give up.
- **Size matters**: let the framework grow sizes, but cap them so quick mode stays fast.
- **Seed and log**: always print the seed and the shrunk counterexample.

## Avoiding false alarms

Before calling a failure a bug:
1. Did the generator produce an input the contract forbids? Then fix the generator, unless the code fails *unsafely*.
2. Is the asserted property really promised? `round(x, 2)` on floats is *not* exact; compare with a tolerance.
3. Is it the harness? Timeouts that are too tight, shared temp dirs between parallel runs, or mocks that behave unlike the real dependency.
4. Reproduce through the **public** API, not a private helper.
5. If the behavior is surprising but arguably intended, report it as a *question*, not a bug.
