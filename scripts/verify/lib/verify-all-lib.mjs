// PROJEXA-BUILD-001 verify runners -- shared pieces of scripts/verify/verify-all.mjs (BR-313) and scripts/verify/phase-gate.mjs
// (BR-401, BR-501): the result classification, the evidence_ref rule, the expected-output rule, the CSV reader, secret redaction,
// and the one function that runs a shell command with a timeout. No network and no database in here.
//
// Result classes for a requirement row (see classifyCheck):
//   PASS     the verify_command exited 0, or the row has no command and its evidence_ref is well formed
//   FAIL     the check failed AND the row claims to be done (status starts with DONE, closure_state CLOSED, or built YES)
//   OPEN     the check failed but the row makes no such claim
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrub } from "./mgmt-sql.mjs";

// ---------------------------------------------------------------------------------------------- classification

const up = (v) => String(v ?? "").trim().toUpperCase();

/** A row claims to be done when its status starts with DONE, its closure_state is CLOSED, or built is YES. */
export function claimsDone(row) {
  return up(row.status).startsWith("DONE") || up(row.closure_state) === "CLOSED" || up(row.built) === "YES";
}

// BR-311 forms: a 7 to 40 hex commit id, PR#<n>, SQL yyyy-mm-dd: <value>. U-23 adds, for built = 'n/a' rows only, a dated read:
// CHECK yyyy-mm-dd: <what was read> -> <value>. [\s\S] stands for the SQL regex's ".", which also matches a newline.
const EVIDENCE_COMMON = /^(?:[0-9a-f]{7,40}|PR#[0-9]+|SQL [0-9]{4}-[0-9]{2}-[0-9]{2}: [\s\S]+)$/;
const EVIDENCE_CHECK = /^CHECK [0-9]{4}-[0-9]{2}-[0-9]{2}: [\s\S]+ -> [\s\S]+$/;

/** True when evidence_ref has one of the allowed forms for a row with this `built` value. */
export function evidenceRefWellFormed(evidenceRef, built) {
  if (typeof evidenceRef !== "string" || evidenceRef === "") return false;
  if (EVIDENCE_COMMON.test(evidenceRef)) return true;
  return String(built ?? "").trim().toLowerCase() === "n/a" && EVIDENCE_CHECK.test(evidenceRef);
}

/** A row has a command when verify_command is a non-blank string. */
export function hasCommand(row) {
  return typeof row.verify_command === "string" && row.verify_command.trim() !== "";
}

// A verify_command comes from a database row, so it is code that arrives from data. Only the four forms the register uses are run;
// any other text is refused and the row is classified as a failed check. Extending the list is a one-line change here.
export const ALLOWED_COMMAND_PREFIXES = ["bun test --isolate ", "node scripts/verify/", "bash scripts/verify/", 'test "$('];

export function commandFormAllowed(command) {
  const c = String(command ?? "").trimStart();
  return ALLOWED_COMMAND_PREFIXES.some((p) => c.startsWith(p));
}

/**
 * @param {{status?: string, closure_state?: string, built?: string, verify_command?: string|null, evidence_ref?: string|null}} row
 * @param {{ commandExit?: number | null }} result exit code of the command when it was run (null = timed out, or not run)
 * @returns {{ cls: "PASS"|"FAIL"|"OPEN", noCommand: boolean }}
 */
export function classifyCheck(row, result = {}) {
  const claimed = claimsDone(row);
  if (!hasCommand(row)) {
    if (evidenceRefWellFormed(row.evidence_ref, row.built)) return { cls: "PASS", noCommand: true };
    return { cls: claimed ? "FAIL" : "OPEN", noCommand: true };
  }
  if (result.commandExit === 0) return { cls: "PASS", noCommand: false };
  return { cls: claimed ? "FAIL" : "OPEN", noCommand: false };
}

/** The text printed after CHECK <id>: PASS, or NO-COMMAND PASS for a row with no command. */
export function classLabel(c) {
  return c.noCommand ? "NO-COMMAND " + c.cls : c.cls;
}

export function summarize(checks) {
  let pass = 0;
  let fail = 0;
  let open = 0;
  let nocommandPass = 0;
  for (const c of checks) {
    if (c.cls === "FAIL") fail++;
    else if (c.cls === "OPEN") open++;
    else if (c.noCommand) nocommandPass++;
    else pass++;
  }
  return { n: checks.length, pass, fail, open, nocommandPass };
}

// ------------------------------------------------------------------------------------------ expected output rule

/**
 * What a register row's expected_output says the output must carry. Wordings the register uses:
 *   contains "..."  /  stdout contains "..."  /  output contains "..."   -> `contains`   (in stdout or stderr: bun prints its counts on stderr)
 *   stdout last line "..."                                                 -> `lastLine`   (the last non-blank stdout line equals it)
 *   stdout "..."                                                           -> `stdoutLines` (some stdout line equals it: the value printed)
 *   stdout empty                                                           -> `stdoutEmpty`
 * Any other wording (compared value "...", a bare EXIT 0) adds no requirement; the exit code must always be 0.
 */
export function parseExpectedOutput(expected) {
  const contains = [];
  const lastLine = [];
  const stdoutLines = [];
  const re = /\b(?:(?:stdout|output)\s+)?(last line|contains)\s+"([^"]*)"|\b(?:stdout|output)\s+"([^"]*)"/g;
  let m;
  const text = String(expected ?? "");
  while ((m = re.exec(text)) !== null) {
    if (m[1] === "last line") lastLine.push(m[2]);
    else if (m[1] === "contains") contains.push(m[2]);
    else stdoutLines.push(m[3]);
  }
  return { contains, lastLine, stdoutLines, stdoutEmpty: /\bstdout empty\b/.test(text) };
}

/** The pass rule of the register runner: exit 0, and everything parseExpectedOutput finds in expected_output is true of the output. */
export function checkExpectedOutput(expected, { code, stdout, stderr }) {
  if (code !== 0) return { ok: false, reason: code === null ? "timed out" : "exit " + code };
  const { contains, lastLine, stdoutLines, stdoutEmpty } = parseExpectedOutput(expected);
  const text = String(stdout ?? "") + "\n" + String(stderr ?? "");
  for (const s of contains) {
    if (!text.includes(s)) return { ok: false, reason: 'output does not contain "' + s + '"' };
  }
  const lines = String(stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const last = lines.length ? lines[lines.length - 1] : "";
  for (const s of lastLine) {
    if (last !== s.trim()) return { ok: false, reason: 'last stdout line is not "' + s + '"' };
  }
  for (const s of stdoutLines) {
    if (!lines.includes(s.trim())) return { ok: false, reason: 'no stdout line equals "' + s + '"' };
  }
  if (stdoutEmpty && lines.length > 0) return { ok: false, reason: "stdout is not empty" };
  return { ok: true, reason: "" };
}

// ------------------------------------------------------------------------------------------------ CSV reader

/** RFC 4180 reader: quoted cells, "" for a quote, newlines inside quotes, LF or CRLF, an optional BOM. Returns rows of strings. */
export function parseCsv(text) {
  const src = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      endCell();
      i++;
    } else if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (inQuotes) throw new Error("CSV has an unterminated quoted cell");
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/** CSV text to an array of objects keyed by the header row. Every data row must have as many cells as the header. */
export function parseCsvObjects(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0] === "") continue; // blank line
    if (cells.length !== header.length) throw new Error("CSV row " + (r + 1) + " has " + cells.length + " cells, the header has " + header.length);
    const o = {};
    header.forEach((h, k) => {
      o[h] = cells[k];
    });
    out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- redaction, tails

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|SERVICE_ROLE|DATABASE_URL|CONNECTION)/i;

/** Values of environment variables that look like secrets, to be removed from anything printed. */
export function secretValuesFromEnv(env = process.env) {
  const out = [];
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && v.length >= 8 && SECRET_NAME.test(k)) out.push(v);
  }
  return out;
}

/** The last `max` characters of `text`, credentials removed and whitespace collapsed to single spaces. */
export function redactedTail(text, max = 200, secrets = []) {
  const chunk = String(text ?? "").slice(-Math.max(max * 10, 2000));
  const clean = scrub(chunk, secrets).replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(clean.length - max) : clean;
}

// ------------------------------------------------------------------------------------------- running a command

const MAX_KEPT = 4 * 1024 * 1024; // characters kept per stream; older output is dropped first

/** Git Bash on Windows, plain bash elsewhere. */
export function resolveBash() {
  if (process.platform === "win32") {
    for (const p of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) {
      if (existsSync(p)) return p;
    }
  }
  return "bash";
}

function killTree(child) {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

// Git Bash (MSYS) keeps its own process table: a program that bash starts (sleep, awk, a subshell) can have a Windows parent process
// that is not in the tree below bash.exe, so `taskkill /T` on bash.exe leaves it running with the output pipes open. On Windows the
// command therefore runs under GNU `timeout`, which signals the whole MSYS process group; the timer in Node is only the backstop.
// `timeout` exits 124 when it had to stop the command (137 when it needed SIGKILL); those two codes read as a timeout there.
const TIMEOUT_EXIT_CODES = new Set([124, 137]);
const BACKSTOP_MS = 20_000;

/**
 * Run `command` as a bash script from `cwd`. The command goes into a temporary script file, so the quotes, pipes and $() inside it
 * reach bash exactly as written (no argument quoting rules in between). Resolves, never rejects. A command that runs longer than
 * `timeoutMs` is killed with its child processes; the result then has timedOut true and code null.
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, seconds: number, timedOut: boolean }>}
 */
export function runBashCommand(command, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const win = process.platform === "win32";
    const dir = mkdtempSync(join(tmpdir(), "verify-cmd-"));
    const posix = (p) => p.replace(/\\/g, "/");
    const cmdFile = join(dir, "cmd.sh");
    writeFileSync(cmdFile, String(command) + "\n", "utf8");
    let entry = cmdFile;
    if (win && !posix(cmdFile).includes("'")) {
      entry = join(dir, "run.sh");
      const secs = String(timeoutMs / 1000);
      writeFileSync(
        entry,
        `if command -v timeout >/dev/null 2>&1; then exec timeout -k 5 ${secs} bash '${posix(cmdFile)}'; else exec bash '${posix(cmdFile)}'; fi\n`,
        "utf8",
      );
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let exitCode = null;
    let done = false;
    let backstop;
    const finish = (code, extraErr) => {
      if (done) return;
      done = true;
      clearTimeout(backstop);
      try {
        child?.stdout?.destroy();
        child?.stderr?.destroy();
      } catch {
        /* streams already closed */
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the temp folder is removed by the OS eventually */
      }
      if (extraErr) stderr += extraErr;
      if (win && entry !== cmdFile && !timedOut && code !== null && TIMEOUT_EXIT_CODES.has(code)) timedOut = true;
      resolve({ code: timedOut ? null : code, stdout, stderr, seconds: (Date.now() - started) / 1000, timedOut });
    };
    let child;
    try {
      child = spawn(resolveBash(), [posix(entry)], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: !win,
        windowsHide: true,
      });
    } catch (e) {
      finish(127, "cannot start bash: " + String(e && e.message ? e.message : e));
      return;
    }
    const keep = (cur, chunk) => {
      const next = cur + chunk.toString("utf8");
      return next.length > MAX_KEPT ? next.slice(next.length - MAX_KEPT) : next;
    };
    child.stdout.on("data", (c) => {
      stdout = keep(stdout, c);
    });
    child.stderr.on("data", (c) => {
      stderr = keep(stderr, c);
    });
    backstop = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // A survivor can keep the pipes open for a long time; stop waiting for them shortly after the process itself is gone.
      setTimeout(() => finish(exitCode, ""), 2000);
    }, win ? timeoutMs + BACKSTOP_MS : timeoutMs);
    child.on("error", (e) => finish(127, "cannot start bash: " + String(e && e.message ? e.message : e)));
    child.on("exit", (code) => {
      exitCode = code;
    });
    child.on("close", (code) => finish(code, ""));
  });
}

/** The environment a verify command runs in: the caller's, plus mgmt SQL mode, plus the npm folder (bun) on Windows. */
export function childEnv(base = process.env) {
  const env = { ...base, VERIFY_SQL_MODE: "mgmt" };
  if (process.platform === "win32" && base.APPDATA) {
    const npmDir = join(base.APPDATA, "npm");
    const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    const cur = env[key] ?? "";
    if (!cur.split(";").some((p) => p.toLowerCase() === npmDir.toLowerCase())) env[key] = cur ? cur + ";" + npmDir : npmDir;
  }
  return env;
}

/** A timeout in milliseconds from the environment variable `name` (whole seconds, 1 to 7200), or `defaultSeconds` when it is unset. */
export function timeoutMsFromEnv(env, name, defaultSeconds) {
  const raw = env[name];
  if (raw === undefined || raw === "") return defaultSeconds * 1000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 7200) throw new Error(name + " must be a whole number of seconds from 1 to 7200");
  return n * 1000;
}
