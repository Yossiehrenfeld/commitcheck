#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format, lint, type Config, type LintResult } from "./index.js";
import { loadConfig } from "./config.js";

const HELP = `commitcheck — lint commit messages against Conventional Commits

Usage:
  commitcheck "feat: add login"          lint a message given as an argument
  echo "fix: typo" | commitcheck         lint a message from stdin
  commitcheck --edit [file]              lint a file (default .git/COMMIT_EDITMSG), for commit-msg hooks
  commitcheck --range <a..b>             lint every commit in a git range, e.g. origin/main..HEAD
  commitcheck --install-hook             install a git commit-msg hook in this repo

Options:
  --json             print results as JSON
  --strict           treat warnings as errors
  --max-length <n>   header max length (default 72)
  --types <a,b,c>    allowed types (default feat,fix,docs,style,refactor,perf,test,build,ci,chore,revert)
  --scopes <a,b>     allowed scopes (default: any)
  --require-scope    require a scope
  -h, --help         show this help
  -v, --version      show the version

Config: .commitcheckrc.json, or a "commitcheck" key in package.json.
Exit codes: 0 all valid, 1 a message is invalid, 2 usage or git error.`;

function die(msg: string): never {
  process.stderr.write(`commitcheck: ${msg}\n`);
  process.exit(2);
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    die(`git ${args.join(" ")} failed: ${(err.stderr || err.message).trim()}`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const HOOK = `#!/bin/sh
# installed by commitcheck
npx --no-install commitcheck --edit "$1"
`;

async function main(argv: string[]): Promise<number> {
  const overrides: Partial<Config> = {};
  let json = false;
  let edit: string | null = null;
  let range: string | null = null;
  let installHook = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? die(`${a} needs a value`);
    switch (a) {
      case "-h": case "--help": process.stdout.write(HELP + "\n"); return 0;
      case "-v": case "--version": {
        const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        process.stdout.write(pkg.version + "\n");
        return 0;
      }
      case "--json": json = true; break;
      case "--strict": overrides.strict = true; break;
      case "--require-scope": overrides.requireScope = true; break;
      case "--max-length": {
        const n = Number(next());
        if (!Number.isInteger(n) || n <= 0) die("--max-length must be a positive integer");
        overrides.headerMaxLength = n;
        break;
      }
      case "--types": overrides.types = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--scopes": overrides.scopes = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--edit":
        edit = argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : ".git/COMMIT_EDITMSG";
        break;
      case "--range": range = next(); break;
      case "--install-hook": installHook = true; break;
      default:
        if (a.startsWith("-") && a !== "-") die(`unknown option ${a} (see --help)`);
        positional.push(a);
    }
  }

  if (installHook) {
    const hooksDir = git(["rev-parse", "--git-path", "hooks"]).trim();
    const path = join(hooksDir, "commit-msg");
    if (existsSync(path) && !readFileSync(path, "utf8").includes("commitcheck")) {
      die(`${path} already exists and was not written by commitcheck; add "npx commitcheck --edit \\"$1\\"" to it yourself`);
    }
    writeFileSync(path, HOOK);
    chmodSync(path, 0o755);
    process.stdout.write(`installed ${path}\n`);
    return 0;
  }

  let config: Partial<Config>;
  try {
    config = { ...loadConfig().config, ...overrides };
  } catch (e) {
    die((e as Error).message);
  }

  const items: { label?: string; result: LintResult }[] = [];
  if (range) {
    const out = git(["log", "--format=%H%x00%B%x1e", range]);
    for (const rec of out.split("\x1e")) {
      const trimmed = rec.replace(/^\n+/, "");
      if (!trimmed) continue;
      const [sha, body] = trimmed.split("\x00");
      items.push({ label: sha.slice(0, 7), result: lint(body ?? "", config) });
    }
    if (items.length === 0) {
      process.stdout.write(json ? "[]\n" : `no commits in ${range}\n`);
      return 0;
    }
  } else {
    let message: string;
    if (edit) {
      if (!existsSync(edit)) die(`no such file: ${edit}`);
      message = readFileSync(edit, "utf8");
    } else if (positional.length && positional[0] !== "-") {
      message = positional.join(" ");
    } else if (!process.stdin.isTTY || positional[0] === "-") {
      message = await readStdin();
    } else {
      process.stdout.write(HELP + "\n");
      return 2;
    }
    items.push({ result: lint(message, config) });
  }

  if (json) {
    process.stdout.write(JSON.stringify(items.map(({ label, result }) => (label ? { commit: label, ...result } : result)), null, 2) + "\n");
  } else {
    for (const { label, result } of items) process.stdout.write(format(result, label) + "\n");
  }
  return items.every((i) => i.result.valid) ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => die((e as Error).message),
);
