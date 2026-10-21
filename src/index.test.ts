import { describe, expect, it } from "vitest";
import { cleanMessage, format, isIgnored, lint, parse } from "./index.js";
import { validateConfig } from "./config.js";

const rules = (msg: string, cfg = {}) => {
  const r = lint(msg, cfg);
  return { errors: r.errors.map((e) => e.rule), warnings: r.warnings.map((w) => w.rule), valid: r.valid };
};

describe("parse", () => {
  it("splits type, scope, bang and subject", () => {
    const p = parse("feat(api)!: drop v1 endpoints");
    expect(p).toMatchObject({ type: "feat", scope: "api", breaking: true, subject: "drop v1 endpoints" });
  });

  it("reads body and footers", () => {
    const p = parse("fix: handle null\n\nThe parser crashed on null input.\n\nRefs: #12\nBREAKING CHANGE: null now throws");
    expect(p.body).toBe("The parser crashed on null input.");
    expect(p.footers).toEqual([
      { token: "Refs", value: "#12" },
      { token: "BREAKING CHANGE", value: "null now throws" },
    ]);
    expect(p.breaking).toBe(true);
  });

  it("supports `token #value` footers like Closes #4", () => {
    expect(parse("fix: x\n\nCloses #4").footers).toEqual([{ token: "Closes", value: "4" }]);
  });

  it("does not treat a prose body as footers", () => {
    const p = parse("docs: readme\n\nExplain how config works.\nNote: it is optional.");
    expect(p.footers).toEqual([]);
    expect(p.body).toContain("Note: it is optional.");
  });

  it("returns nulls for a non-conventional header", () => {
    expect(parse("updated stuff")).toMatchObject({ type: null, scope: null, subject: null });
  });
});

describe("cleanMessage", () => {
  it("drops comments, scissors and surrounding blank lines like git", () => {
    const raw = "\nfeat: add x  \n\n# Please enter the commit message\nbody\n# ------------------------ >8 ------------------------\ndiff --git a b\n";
    expect(cleanMessage(raw)).toBe("feat: add x\n\nbody");
  });
  it("normalizes CRLF", () => {
    expect(cleanMessage("fix: a\r\n\r\nb\r\n")).toBe("fix: a\n\nb");
  });
});

describe("lint", () => {
  it("accepts good messages", () => {
    for (const m of [
      "feat: add login",
      "fix(parser): handle empty input",
      "refactor!: rename config keys",
      "docs(readme): explain --json\n\nAdds an example.\n\nRefs: #3",
    ]) {
      expect(rules(m)).toEqual({ errors: [], warnings: [], valid: true });
    }
  });

  it("rejects a header without a type", () => {
    expect(rules("updated stuff").errors).toEqual(["header-format"]);
  });

  it("rejects an unknown type and hints at casing", () => {
    const r = lint("Feat: add login");
    expect(r.errors[0].rule).toBe("type-enum");
    expect(r.errors[0].message).toContain('did you mean "feat"');
    expect(rules("feature: add login").errors).toEqual(["type-enum"]);
  });

  it("enforces header length", () => {
    expect(rules("feat: " + "a".repeat(80)).errors).toEqual(["header-max-length"]);
    expect(rules("feat: " + "a".repeat(80), { headerMaxLength: 100 }).errors).toEqual([]);
  });

  it("flags an empty subject or empty scope", () => {
    expect(rules("feat: ").errors).toContain("subject-empty");
    expect(rules("feat(): add").errors).toEqual(["scope-empty"]);
    expect(rules("feat:add").errors).toEqual(["subject-space"]);
  });

  it("warns on trailing period and uppercase subject", () => {
    expect(rules("fix: Fix the thing.").warnings).toEqual(["subject-full-stop", "subject-case"]);
    expect(rules("fix: Fix the thing", { subjectCase: "any" }).warnings).toEqual([]);
    // acronyms are fine
    expect(rules("fix: API returns 500").warnings).toEqual([]);
  });

  it("strict mode turns warnings into errors", () => {
    expect(rules("fix: done.", { strict: true })).toEqual({ errors: ["subject-full-stop"], warnings: [], valid: false });
  });

  it("checks scopes against an allow-list and requireScope", () => {
    expect(rules("feat(ui): x", { scopes: ["api", "cli"] }).errors).toEqual(["scope-enum"]);
    expect(rules("feat(cli): x", { scopes: ["api", "cli"] }).errors).toEqual([]);
    expect(rules("feat: x", { requireScope: true }).errors).toEqual(["scope-required"]);
  });

  it("requires a blank line before the body", () => {
    const r = lint("feat: x\nbody right away");
    expect(r.errors).toMatchObject([{ rule: "body-leading-blank", line: 2 }]);
  });

  it("warns on long body lines but not bare URLs", () => {
    expect(rules("feat: x\n\n" + "word ".repeat(30)).warnings).toEqual(["body-max-line-length"]);
    expect(rules("feat: x\n\nhttps://example.com/" + "a".repeat(120)).warnings).toEqual([]);
  });

  it("rejects an empty BREAKING CHANGE footer", () => {
    expect(rules("feat: x\n\nBREAKING CHANGE: ").errors).toEqual(["breaking-change-empty"]);
  });

  it("rejects an empty message (comments only)", () => {
    expect(rules("# just a comment\n\n").errors).toEqual(["empty"]);
  });

  it("skips merge, revert and fixup commits", () => {
    for (const m of ["Merge branch 'main' into dev", "Merge pull request #5 from a/b", 'Revert "feat: x"', "fixup! feat: x"]) {
      expect(isIgnored(m)).toBe(true);
      expect(lint(m)).toMatchObject({ valid: true, ignored: true });
    }
  });

  it("honours custom types", () => {
    expect(rules("wip: half done", { types: ["wip", "feat"] }).errors).toEqual([]);
  });
});

describe("format", () => {
  it("prints ok, errors and warnings", () => {
    expect(format(lint("feat: x"))).toBe("ok  feat: x");
    const out = format(lint("Feat: X."), "abc1234");
    expect(out).toContain("abc1234: invalid  Feat: X.");
    expect(out).toContain("✖ line 1:");
    expect(out).toContain("[type-enum]");
  });
});

describe("validateConfig", () => {
  it("accepts known keys", () => {
    expect(validateConfig({ types: ["feat"], headerMaxLength: 50, strict: true })).toEqual({ types: ["feat"], headerMaxLength: 50, strict: true });
  });
  it("rejects unknown keys and bad values", () => {
    expect(() => validateConfig({ typo: 1 })).toThrow(/unknown option "typo"/);
    expect(() => validateConfig({ headerMaxLength: "50" })).toThrow(/non-negative integer/);
    expect(() => validateConfig({ subjectCase: "upper" })).toThrow(/subjectCase/);
  });
});
