# Contributing to Bongo 🐒

Thanks for feeding the monkey! Good first contributions:

- **A new chaos trick** in [`skills/monkey-test/references/chaos-catalog.md`](skills/monkey-test/references/chaos-catalog.md). Include what it breaks and why.
- **A framework template** in [`references/frameworks.md`](skills/monkey-test/references/frameworks.md) for a language or library we don't cover yet.
- **Stack detection** for another ecosystem in [`scripts/detect_stack.mjs`](skills/monkey-test/scripts/detect_stack.mjs).
- **A planted bug** in [`examples/buggy-utils`](examples/buggy-utils) that Bongo should catch, along with its spoiler line in that README.
- **Bongo voice lines** in [`references/report.md`](skills/monkey-test/references/report.md). Keep them short, kind and funny.

## Ground rules

1. Keep `SKILL.md` lean (under 500 lines). Put details in `references/`, one level deep.
2. Scripts stay **zero-dependency** (Node 18+ built-ins only; the UI monkey may load Playwright from the user's project).
3. Safety first: never add anything that targets non-local hosts or performs destructive actions by default.
4. Use only portable frontmatter keys in `SKILL.md` (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`) so the skill also uploads to claude.ai and the API.

## Development

```bash
node --test tests/*.test.mjs        # hook + script tests
claude plugin validate .            # manifest checks
claude --plugin-dir .               # try the plugin locally, then /reload-plugins after edits
```

To preview the site, serve `site/` with any static server, for example `python -m http.server -d site`.

## Releasing

Bump `version` in `.claude-plugin/plugin.json`. Users only receive updates when the version changes.
