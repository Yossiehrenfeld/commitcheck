import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(__dirname, "..", "dist", "cli.js");
const run = (args: string[], opts: { input?: string; cwd?: string } = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input: opts.input ?? "", cwd: opts.cwd });

describe.runIf(existsSync(CLI))("cli (built)", () => {
  it("passes a good message and fails a bad one", () => {
    expect(run(["feat: add login"]).status).toBe(0);
    const bad = run(["added login"]);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("header-format");
  });

  it("reads stdin and prints JSON", () => {
    const r = run(["--json"], { input: "fix(api): handle 404\n" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)[0]).toMatchObject({ valid: true, parsed: { type: "fix", scope: "api" } });
  });

  it("lints a commit-msg file with --edit", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-"));
    const f = join(dir, "COMMIT_EDITMSG");
    writeFileSync(f, "docs: update readme\n\n# Please enter the commit message\n");
    expect(run(["--edit", f]).status).toBe(0);
  });

  it("exits 2 on bad usage", () => {
    expect(run(["--nope"]).status).toBe(2);
  });

  it("lints a git range and installs a hook", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-git-"));
    const g = (...a: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" });
    g("init", "-q");
    g("commit", "-q", "--allow-empty", "-m", "chore: init");
    g("commit", "-q", "--allow-empty", "-m", "feat: good one");
    g("commit", "-q", "--allow-empty", "-m", "bad one");
    const r = run(["--range", "HEAD~2..HEAD"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().split("\n")[0]).toMatch(/^[0-9a-f]{7}: invalid  bad one/);
    expect(r.stdout).toMatch(/ok  feat: good one/);

    const h = run(["--install-hook"], { cwd: dir });
    expect(h.status).toBe(0);
    expect(readFileSync(join(dir, ".git", "hooks", "commit-msg"), "utf8")).toContain("commitcheck --edit");
  });

  it("picks up .commitcheckrc.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-rc-"));
    writeFileSync(join(dir, ".commitcheckrc.json"), JSON.stringify({ types: ["wip"] }));
    expect(run(["wip: something"], { cwd: dir }).status).toBe(0);
    expect(run(["feat: something"], { cwd: dir }).status).toBe(1);
  });
});
