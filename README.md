# commitcheck

[![CI](https://github.com/Yossiehrenfeld/commitcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/Yossiehrenfeld/commitcheck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Lint commit messages against [Conventional Commits](https://www.conventionalcommits.org/) — as a
`commit-msg` hook, in CI over a range of commits, or as a library. Zero runtime dependencies, one
small binary, readable errors.

```
$ commitcheck "Feat: Added login."
invalid  Feat: Added login.
  ✖ line 1: type "Feat" is not allowed (did you mean "feat"?); use one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert [type-enum]
  ⚠ line 1: subject should not end with a period [subject-full-stop]
  ⚠ line 1: subject should start with a lowercase letter [subject-case]

$ commitcheck "feat(cli): add --json flag"
ok  feat(cli): add --json flag
```

## Install

```sh
npm install --save-dev github:Yossiehrenfeld/commitcheck   # from GitHub
```

Or clone and build it yourself:

```sh
git clone https://github.com/Yossiehrenfeld/commitcheck && cd commitcheck
npm install && npm run build && npm link   # puts `commitcheck` on your PATH
```

Requires Node 18+.

## Usage

### As a git hook

```sh
npx commitcheck --install-hook
```

writes `.git/hooks/commit-msg`, which runs `commitcheck --edit "$1"` on every commit. A bad
message stops the commit and says why. (Already using husky? Put `npx --no-install commitcheck --edit "$1"`
in `.husky/commit-msg`.)

### In CI (GitHub Actions)

Check every commit a pull request adds:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: npx commitcheck --range origin/${{ github.base_ref }}..HEAD
```

```
$ commitcheck --range origin/main..HEAD
3f9c2a1: invalid  bad one
  ✖ line 1: header must look like "type(scope): subject", e.g. "feat(cli): add --json flag" [header-format]
8d01e4b: ok  feat: good one
```

### Anywhere else

```sh
commitcheck "fix: handle empty input"     # argument
git log -1 --format=%B | commitcheck      # stdin
commitcheck --edit path/to/message.txt    # file
commitcheck --json "feat!: drop node 16"  # machine-readable
```

### Options

| Flag | Meaning |
| --- | --- |
| `--edit [file]` | Lint a file (default `.git/COMMIT_EDITMSG`). Comment lines and everything below git's scissors line are ignored, like git does. |
| `--range <a..b>` | Lint every commit in a git range. |
| `--install-hook` | Install the `commit-msg` hook in the current repo. |
| `--json` | Print results (including the parsed type/scope/footers) as JSON. |
| `--strict` | Treat warnings as errors. |
| `--max-length <n>` | Header max length (default 72). |
| `--types a,b,c` | Allowed types. |
| `--scopes a,b` | Allowed scopes (default: any). |
| `--require-scope` | Require a scope. |

Exit codes: `0` all messages valid, `1` at least one invalid, `2` usage or git error.

## Rules

| Rule | Level | Example that fails |
| --- | --- | --- |
| `header-format` | error | `updated stuff` |
| `type-enum` | error | `feature: add x` |
| `scope-enum` / `scope-required` / `scope-empty` | error | `feat(): x` |
| `subject-empty` / `subject-space` | error | `feat:add x` |
| `header-max-length` | error | a first line over 72 characters |
| `body-leading-blank` | error | no blank line between header and body |
| `breaking-change-empty` | error | `BREAKING CHANGE:` with no description |
| `subject-full-stop` | warning | `fix: typo.` |
| `subject-case` | warning | `fix: Fix typo` (acronyms like `API` are fine) |
| `body-max-line-length` | warning | body lines over 100 characters (bare URLs are fine) |

Merge commits, `Revert "..."`, `fixup!`/`squash!` commits and `Initial commit` are skipped.

## Configuration

Put a `.commitcheckrc.json` in your repo (or a `"commitcheck"` key in `package.json`):

```json
{
  "types": ["feat", "fix", "docs", "chore", "ci"],
  "scopes": ["api", "cli", "web"],
  "requireScope": false,
  "headerMaxLength": 72,
  "bodyMaxLineLength": 100,
  "subjectCase": "lower",
  "strict": false
}
```

Unknown keys and wrong types are reported instead of silently ignored. CLI flags override the file.

## Library

```ts
import { lint, parse, format } from "commitcheck";

const result = lint("feat(api)!: drop v1 endpoints\n\nBREAKING CHANGE: /v1 is gone");
result.valid;            // true
result.parsed;           // { type: "feat", scope: "api", breaking: true, subject: "drop v1 endpoints", body: "", footers: [...] }

lint("Fix: Stuff.", { strict: true }).errors.map((e) => e.rule);
// ["type-enum", "subject-full-stop", "subject-case"]

console.log(format(lint("oops")));
```

## Development

```sh
npm install
npm run build
npm test
```

## License

MIT © Yosef Ehrenfeld
