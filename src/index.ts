/**
 * commitcheck — a zero-dependency Conventional Commits linter.
 */

export const DEFAULT_TYPES = [
  "feat", "fix", "docs", "style", "refactor", "perf",
  "test", "build", "ci", "chore", "revert",
] as const;

export type Severity = "error" | "warning";

export interface Config {
  /** Allowed commit types. */
  types: string[];
  /** Allowed scopes. Empty = any scope is fine. */
  scopes: string[];
  /** Require a scope, e.g. `feat(api): ...`. */
  requireScope: boolean;
  /** Maximum header (first line) length. */
  headerMaxLength: number;
  /** Maximum length of body/footer lines (warning). 0 disables. */
  bodyMaxLineLength: number;
  /** "lower" warns when the subject starts with an uppercase letter; "any" disables. */
  subjectCase: "lower" | "any";
  /** Treat warnings as errors. */
  strict: boolean;
}

export const DEFAULT_CONFIG: Config = {
  types: [...DEFAULT_TYPES],
  scopes: [],
  requireScope: false,
  headerMaxLength: 72,
  bodyMaxLineLength: 100,
  subjectCase: "lower",
  strict: false,
};

export interface Problem {
  rule: string;
  severity: Severity;
  message: string;
  /** 1-based line number in the cleaned message. */
  line: number;
}

export interface Footer {
  token: string;
  value: string;
}

export interface ParsedCommit {
  header: string;
  type: string | null;
  scope: string | null;
  breaking: boolean;
  subject: string | null;
  body: string;
  footers: Footer[];
}

export interface LintResult {
  valid: boolean;
  /** True when the message was skipped (merge commits, fixup!/squash!, git reverts). */
  ignored: boolean;
  errors: Problem[];
  warnings: Problem[];
  parsed: ParsedCommit;
}

const HEADER_RE = /^(?<type>[A-Za-z][\w-]*)(?:\((?<scope>[^()\r\n]*)\))?(?<bang>!)?:(?<space> ?)(?<subject>.*)$/;
const FOOTER_RE = /^(?<token>BREAKING CHANGE|BREAKING-CHANGE|[A-Za-z][\w-]*)(?:: | #|:$)(?<value>.*)$/;

/**
 * Clean a raw commit message the way git does by default:
 * drops `#` comment lines, everything below a scissors line, trailing
 * whitespace and leading/trailing blank lines.
 */
export function cleanMessage(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^# -+ >8 -+/.test(line)) break;
    if (line.startsWith("#")) continue;
    out.push(line.replace(/\s+$/, ""));
  }
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** Parse a (cleaned) commit message into its Conventional Commits parts. */
export function parse(message: string): ParsedCommit {
  const lines = message.split("\n");
  const header = lines[0] ?? "";
  const m = HEADER_RE.exec(header);
  const rest = lines.slice(1);
  // footers: the trailing paragraph whose lines all look like footers
  let footerStart = rest.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    const l = rest[i];
    if (l === "") break;
    if (FOOTER_RE.test(l)) footerStart = i;
    else if (footerStart !== rest.length && /^\s/.test(l)) continue; // continuation line
    else { footerStart = rest.length; break; }
  }
  const footerLines = rest.slice(footerStart);
  const footers: Footer[] = [];
  for (const l of footerLines) {
    const f = FOOTER_RE.exec(l);
    if (f?.groups) footers.push({ token: f.groups.token, value: f.groups.value });
    else if (footers.length) footers[footers.length - 1].value += "\n" + l.trim();
  }
  const body = rest.slice(0, footerStart).join("\n").replace(/^\n+|\n+$/g, "");
  const breaking = Boolean(m?.groups?.bang) ||
    footers.some((f) => f.token === "BREAKING CHANGE" || f.token === "BREAKING-CHANGE");
  return {
    header,
    type: m?.groups?.type ?? null,
    scope: m?.groups?.scope ?? null,
    breaking,
    subject: m?.groups ? m.groups.subject : null,
    body,
    footers,
  };
}

/** Messages git or common workflows generate, which are not linted. */
export function isIgnored(message: string): boolean {
  const header = message.split("\n")[0] ?? "";
  return (
    /^Merge (branch|pull request|remote-tracking branch|tag|commit|[0-9a-f]{7,})\b/.test(header) ||
    /^Merged? .* into /.test(header) ||
    /^Revert ".*"/.test(header) ||
    /^(fixup|squash|amend)! /.test(header) ||
    /^Initial commit$/i.test(header)
  );
}

/** Lint a commit message. The raw message is cleaned first (see {@link cleanMessage}). */
export function lint(raw: string, config: Partial<Config> = {}): LintResult {
  const cfg: Config = { ...DEFAULT_CONFIG, ...config };
  const message = cleanMessage(raw);
  const parsed = parse(message);
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const report = (rule: string, severity: Severity, msg: string, line = 1) => {
    const sev: Severity = cfg.strict ? "error" : severity;
    (sev === "error" ? errors : warnings).push({ rule, severity: sev, message: msg, line });
  };

  if (message === "") {
    report("empty", "error", "commit message is empty");
    return { valid: false, ignored: false, errors, warnings, parsed };
  }
  if (isIgnored(message)) {
    return { valid: true, ignored: true, errors, warnings, parsed };
  }

  const { header } = parsed;
  if (header.length > cfg.headerMaxLength) {
    report("header-max-length", "error", `header is ${header.length} characters, max is ${cfg.headerMaxLength}`);
  }

  if (parsed.type === null) {
    report(
      "header-format",
      "error",
      'header must look like "type(scope): subject", e.g. "feat(cli): add --json flag"',
    );
  } else {
    if (!cfg.types.includes(parsed.type)) {
      const lower = parsed.type.toLowerCase();
      const hint = cfg.types.includes(lower) ? ` (did you mean "${lower}"?)` : "";
      report("type-enum", "error", `type "${parsed.type}" is not allowed${hint}; use one of: ${cfg.types.join(", ")}`);
    }
    if (parsed.scope !== null && parsed.scope.trim() === "") {
      report("scope-empty", "error", "scope is empty; remove the parentheses or name a scope");
    } else if (parsed.scope !== null && cfg.scopes.length && !cfg.scopes.includes(parsed.scope)) {
      report("scope-enum", "error", `scope "${parsed.scope}" is not allowed; use one of: ${cfg.scopes.join(", ")}`);
    }
    if (cfg.requireScope && parsed.scope === null) {
      report("scope-required", "error", "a scope is required, e.g. \"fix(parser): ...\"");
    }
    const subject = parsed.subject ?? "";
    if (subject.trim() === "") {
      report("subject-empty", "error", "subject is empty");
    } else {
      if (parsed.subject !== null && !/^ /.test(parsed.header.slice(parsed.header.indexOf(":") + 1))) {
        report("subject-space", "error", 'put a space after the colon: "type: subject"');
      }
      if (/^\s/.test(subject)) report("subject-whitespace", "error", "subject starts with extra whitespace");
      if (/\.$/.test(subject)) report("subject-full-stop", "warning", "subject should not end with a period");
      if (cfg.subjectCase === "lower" && /^[A-Z][a-z]/.test(subject)) {
        report("subject-case", "warning", "subject should start with a lowercase letter");
      }
    }
  }

  const lines = message.split("\n");
  if (lines.length > 1 && lines[1] !== "") {
    report("body-leading-blank", "error", "leave a blank line between the header and the body", 2);
  }
  if (cfg.bodyMaxLineLength > 0) {
    lines.forEach((l, i) => {
      if (i > 0 && l.length > cfg.bodyMaxLineLength && !/^\S+:\/\/\S+$/.test(l.trim())) {
        report("body-max-line-length", "warning", `line is ${l.length} characters, max is ${cfg.bodyMaxLineLength}`, i + 1);
      }
    });
  }
  for (const f of parsed.footers) {
    if ((f.token === "BREAKING CHANGE" || f.token === "BREAKING-CHANGE") && f.value.trim() === "") {
      const idx = lines.findIndex((l) => l.startsWith(f.token));
      report("breaking-change-empty", "error", "BREAKING CHANGE footer needs a description", idx + 1);
    }
  }

  return { valid: errors.length === 0, ignored: false, errors, warnings, parsed };
}

/** Human-readable report for one message. */
export function format(result: LintResult, label?: string): string {
  const head = label ? `${label}: ` : "";
  if (result.ignored) return `${head}skipped (${result.parsed.header})`;
  const out: string[] = [];
  const all = [...result.errors, ...result.warnings].sort((a, b) => a.line - b.line);
  if (all.length === 0) return `${head}ok  ${result.parsed.header}`;
  out.push(`${head}${result.valid ? "ok with warnings" : "invalid"}  ${result.parsed.header}`);
  for (const p of all) {
    out.push(`  ${p.severity === "error" ? "✖" : "⚠"} line ${p.line}: ${p.message} [${p.rule}]`);
  }
  return out.join("\n");
}
