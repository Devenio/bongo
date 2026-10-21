# The Bongo Report

Every monkey test ends with this report. Keep it scannable: a reader should know in five seconds whether the code is safe. In plain mode (emojis discouraged), write bananas as text, for example `(3/5)`, and drop the 🐒 and 💪.

## Banana score

Start at **100 🍌** and subtract points for each **verified** finding:

| Severity | Points | Meaning |
|---|---|---|
| critical | −30 | data loss or corruption, security hole, crash of the whole process or server |
| high | −15 | unhandled exception or 5xx on plausible input, hang, wrong result on common input |
| medium | −7 | wrong result on rare-but-valid input, a leak, a poor error for a bad input |
| low | −3 | cosmetic or UX glitch, inconsistent message, odd behavior only on absurd input |

The floor is 0. Score **one finding per root cause**. Unconfirmed suspicions and open questions cost nothing.

| Score | Verdict |
|---|---|
| 95–100 | 🍌🍌🍌🍌🍌 **Bongo-proof**: "I tried. I really tried." |
| 80–94 | 🍌🍌🍌🍌 **Sturdy**: a few bruises |
| 60–79 | 🍌🍌🍌 **Wobbly**: fix before shipping |
| 30–59 | 🍌🍌 **Shaky**: Bongo is swinging from the chandeliers |
| 0–29 | 🍌 **Banana peel**: do not ship |

## Template

````markdown
## 🐒 Bongo Report: <target> (<mode> mode)

> <one playful Bongo line, omit if BONGO_VOICE=off>

**Banana score: <N>/100** <bananas> **<verdict>**
Thrown: <cases> chaos cases across <K> properties · seed `<seed>` · <duration>
<!-- cases = test cases actually executed (passing properties' runs plus runs until each failure); duration = wall time of the final test run -->

### Findings

#### 1. [<severity>] <short title>
- **Where:** `path/to/file.ext:line` in `functionName`
- **Chaos lane:** <Input | Sequence | Concurrency | Environment | UI | API | CLI | Data>
- **Also seen as:** <other inputs with the same root cause, if any>
- **Minimal repro:**
  ```<lang>
  <smallest code or command that fails>
  ```
- **Expected:** <per contract>
- **Actual:** <error, wrong output, hang>
- **Why it matters:** <one line on user impact>
- **Fix hint:** <one line>

<repeat per finding, most severe first>

### Open questions
- <behavior whose intent is unclear, for example "duplicate units are summed: intended?">, *or* "None".

### Suspicious, unconfirmed
- <thing that looked off but did not reproduce reliably>, *or* "None".

### What survived 💪
- <property> held for <N> cases
- <lane> found nothing on <target>

### Regression tests
- Added `<test file>` with <N> properties and <M> pinned repros (expected failures until fixed), *or* "Fixed: <list>, with regression tests in <file>"

> <closing Bongo line>
````

## Share line and badge (opt-in)

Don't include these by default. Offer them in one short line, and only after a clean or mostly clean run, or when the user seems pleased. Never offer them in hook-triggered runs. If the user wants them:

```
🐒 Bongo threw <N> chaos cases at my code, found <B> bugs, and scored <S>/100 🍌. #BongoTested
```

README badge:

```markdown
[![Bongo tested](https://img.shields.io/badge/%F0%9F%90%92%20bongo-tested%20<S>%2F100-FFD23F)](https://bongo-monkey.vercel.app)
```

## Bongo voice lines

Use at most one at the top and one at the bottom. Pick one that matches what happened, or write a new one in the same spirit. Keep them short and never mean to the user.

**Found bugs**
- "Ooh ooh! Fed your parser a 4 MB emoji. It did not enjoy it. 🍌"
- "I clicked 'Submit' twice. Now there are two of you."
- "Your function met `-0`. They did not get along."
- "Found a banana peel on line 42. Somebody was going to slip."
- "I pressed Back during checkout and the cart filed for divorce."

**Clean run**
- "I threw everything, including the banana. Nothing broke. Respect. 🐒"
- "Bongo-proof. I'm going to go sulk in a tree."
- "Five bananas. Don't let it go to your head."

**Trivial change**
- "Bongo inspected: nothing to monkey with. Back to my tree."
