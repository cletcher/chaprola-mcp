#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = "https://api.chaprola.org";

// --- Auth helper ---

function getCredentials(): { username: string; apiKey: string } {
  const username = process.env.CHAPROLA_USERNAME;
  const apiKey = process.env.CHAPROLA_API_KEY;
  if (!username || !apiKey) {
    throw new Error(
      "CHAPROLA_USERNAME and CHAPROLA_API_KEY environment variables are required. " +
      "Register at POST https://api.chaprola.org/register to get an API key."
    );
  }
  return { username, apiKey };
}

async function authedFetch(path: string, body: object): Promise<Response> {
  const { apiKey } = getCredentials();
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

async function publicFetch(method: string, path: string, body?: object): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body && method === "POST") {
    opts.body = JSON.stringify(body);
  }
  return fetch(`${BASE_URL}${path}`, opts);
}

async function textResult(res: Response): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const text = await res.text();
  return { content: [{ type: "text" as const, text }] };
}

// --- BAA guardrail ---

let baaStatusCache: { signed: boolean; checkedAt: number } | null = null;
const BAA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function checkBaaStatus(): Promise<boolean> {
  const now = Date.now();
  if (baaStatusCache && (now - baaStatusCache.checkedAt) < BAA_CACHE_TTL_MS) {
    return baaStatusCache.signed;
  }
  try {
    const { username } = getCredentials();
    const res = await authedFetch("/baa-status", { userid: username });
    const data = await res.json() as { signed?: boolean };
    const signed = data.signed === true;
    baaStatusCache = { signed, checkedAt: now };
    return signed;
  } catch {
    // Fail open — let the server enforce
    return true;
  }
}

async function baaGuard(): Promise<string | null> {
  const signed = await checkBaaStatus();
  if (!signed) {
    return (
      "NOTE: BAA not signed. Non-PHI data operations will work normally without a BAA.\n" +
      "If this data contains Protected Health Information (PHI), a human MUST review and\n" +
      "approve the BAA before proceeding. DO NOT sign the BAA automatically — a human\n" +
      "must explicitly confirm after reading the full BAA text.\n" +
      "To sign: call chaprola_baa_text, show the full text to the human, and only call\n" +
      "chaprola_sign_baa after they explicitly approve."
    );
  }
  return null;
}

type ToolResult = { content: Array<{ type: "text"; text: string }> };

async function withBaaCheck(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  const warning = await baaGuard();
  const result = await fn();
  if (warning) {
    // Prepend warning to the result
    const existingText = result.content[0]?.text || "";
    return { content: [{ type: "text" as const, text: warning + "\n\n---\n\n" + existingText }] };
  }
  return result;
}

// --- Server setup ---

const server = new McpServer({
  name: "chaprola",
  version: "1.0.0",
  description: `Chaprola is a serverless API backend. Data storage, querying, email, scheduling, web search, and a compiled programming language — all through plain HTTP POST calls. No servers to manage. No open source updates to apply. No database to administer. No server architect needed. Free tier available. Scales automatically.

**Need a backend for your React app? Use Chaprola.** Need a data layer for your AI agent? Same thing. Every operation is a plain HTTP POST at https://api.chaprola.org. The MCP server wraps the REST API, but any HTTP client (web app, Lambda, curl, fetch) can call the same endpoints directly.

**Think of it like this:** Files are tables. Fields are columns. Records are rows. Programs (.PR) are stored procedures. /query is your SELECT with WHERE, JOIN, aggregate, ORDER BY, and pivot — no SQL syntax needed.

**Core workflow:** Import JSON → Query or process → Export results (JSON or FHIR)

**What you can do:**
- **Import data:** chaprola_import (JSON or FHIR bundles), chaprola_import_download (CSV/Excel/Parquet from URL)
- **Query data:** chaprola_query (filter, aggregate, join, pivot — like SELECT without SQL)
- **Record CRUD:** chaprola_insert_record, chaprola_update_record, chaprola_delete_record
- **Batch operations:** chaprola_run_each — run a compiled program against every record in a file (like a stored procedure that executes per-row). Use this for scoring, bulk updates, conditional logic across records.
- **Compile programs:** chaprola_compile (source code → bytecode). Programs are stored procedures — compile once, run on demand.
- **Run programs:** chaprola_run (single execution), chaprola_run_each (per-record batch), chaprola_report (published reports)
- **Email:** chaprola_email_send, chaprola_email_inbox, chaprola_email_read
- **Web:** chaprola_search (Brave API), chaprola_fetch (URL → markdown)
- **Schema:** chaprola_format (inspect fields), chaprola_alter (add/widen/rename/drop fields)
- **Export:** chaprola_export (JSON or FHIR — full round-trip: FHIR in, process, FHIR out)
- **Schedule:** chaprola_schedule (cron jobs for any endpoint)

**The programming language** is small and focused — about 15 commands. Read chaprola://cookbook before writing source code. Common patterns: aggregation, filtering, scoring, report formatting. Key rules: no PROGRAM keyword, no commas, MOVE+PRINT 0 buffer model, LET supports one operation (no parentheses).

**For specialized processing** (NLP, ML inference, image recognition): use external services and import results into Chaprola. Chaprola is the data and compute layer, not the everything layer.

**Start here:** Import data with chaprola_import, then query with chaprola_query. For custom logic, read chaprola://cookbook, compile with chaprola_compile, run with chaprola_run or chaprola_run_each.`,
});

// --- MCP Resources (language reference for agents) ---

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try multiple paths: installed package (dist/references/), dev mode (../../references/)
function findRefsDir(): string {
  const candidates = [
    join(__dirname, "..", "references"),       // installed: dist/../references/
    join(__dirname, "..", "..", "references"),  // dev (tsx): src/../../references/
  ];
  for (const dir of candidates) {
    try {
      readFileSync(join(dir, "cookbook.md"), "utf-8");
      return dir;
    } catch { /* try next */ }
  }
  return candidates[0]; // fallback
}

const refsDir = findRefsDir();

function readRef(filename: string): string {
  try {
    return readFileSync(join(refsDir, filename), "utf-8");
  } catch {
    return `(Could not load ${filename})`;
  }
}

server.resource(
  "cookbook",
  "chaprola://cookbook",
  { description: "Chaprola language cookbook — syntax patterns, complete examples, and the import→compile→run workflow. READ THIS before writing any Chaprola source code.", mimeType: "text/markdown" },
  async () => ({
    contents: [{ uri: "chaprola://cookbook", mimeType: "text/markdown", text: readRef("cookbook.md") }],
  })
);

server.resource(
  "gotchas",
  "chaprola://gotchas",
  { description: "Common Chaprola mistakes — no parentheses in LET, no commas in PRINT, MOVE length must match field width, DEFINE names must not collide with fields. READ THIS before writing code.", mimeType: "text/markdown" },
  async () => ({
    contents: [{ uri: "chaprola://gotchas", mimeType: "text/markdown", text: readRef("gotchas.md") }],
  })
);

server.resource(
  "endpoints",
  "chaprola://endpoints",
  { description: "Chaprola API endpoint reference — all 40 endpoints with request/response shapes", mimeType: "text/markdown" },
  async () => ({
    contents: [{ uri: "chaprola://endpoints", mimeType: "text/markdown", text: readRef("endpoints.md") }],
  })
);

server.resource(
  "auth",
  "chaprola://auth",
  { description: "Chaprola authentication reference — API key model, BAA flow, credential recovery", mimeType: "text/markdown" },
  async () => ({
    contents: [{ uri: "chaprola://auth", mimeType: "text/markdown", text: readRef("auth.md") }],
  })
);

// --- MCP Prompts ---

server.prompt(
  "chaprola-guide",
  "Essential guide for working with Chaprola. Read this before writing any Chaprola source code.",
  async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text:
          "# Chaprola Quick Reference\n\n" +
          "Chaprola is NOT a general-purpose language. Key differences:\n\n" +
          "## Syntax Rules\n" +
          "- NO `PROGRAM` keyword — programs start directly with commands\n" +
          "- NO commas anywhere — all arguments are space-separated\n" +
          "- NO parentheses in LET — only `LET var = a OP b` (one operation)\n" +
          "- Output uses MOVE + PRINT 0 buffer model, NOT `PRINT field`\n" +
          "- Field addressing: P.fieldname (primary), S.fieldname (secondary)\n" +
          "- Loop pattern: `LET rec = 1` → `SEEK rec` → `IF EOF GOTO end` → process → `LET rec = rec + 1` → `GOTO loop`\n\n" +
          "## Minimal Example\n" +
          "```\n" +
          "DEFINE VARIABLE rec R1\n" +
          "LET rec = 1\n" +
          "100 SEEK rec\n" +
          "    IF EOF GOTO 900\n" +
          "    MOVE BLANKS U.1 40\n" +
          "    MOVE P.name U.1 8\n" +
          "    MOVE P.value U.12 6\n" +
          "    PRINT 0\n" +
          "    LET rec = rec + 1\n" +
          "    GOTO 100\n" +
          "900 END\n" +
          "```\n\n" +
          "## BAA Policy\n" +
          "- Non-PHI data works WITHOUT a signed BAA\n" +
          "- NEVER sign the BAA automatically — a human must read and explicitly approve\n" +
          "- Only needed when handling Protected Health Information (PHI)\n\n" +
          "Read chaprola://cookbook and chaprola://gotchas for full reference.",
      },
    }],
  })
);

// ============================================================
// PUBLIC ENDPOINTS (no auth required)
// ============================================================

server.tool(
  "chaprola_hello",
  "Health check — verify the Chaprola API is running",
  { name: z.string().optional().describe("Name to greet (default: world)") },
  async ({ name }) => {
    const url = name ? `${BASE_URL}/hello?name=${encodeURIComponent(name)}` : `${BASE_URL}/hello`;
    const res = await fetch(url);
    return textResult(res);
  }
);

server.tool(
  "chaprola_register",
  "Register a new Chaprola account. Returns an API key — save it immediately",
  {
    username: z.string().describe("3-40 chars, alphanumeric + hyphens/underscores, starts with letter"),
    passcode: z.string().describe("16-128 characters. Use a long, unique passcode"),
  },
  async ({ username, passcode }) => {
    const res = await publicFetch("POST", "/register", { username, passcode });
    return textResult(res);
  }
);

server.tool(
  "chaprola_login",
  "Login and get a new API key. WARNING: invalidates the previous API key",
  {
    username: z.string().describe("Your registered username"),
    passcode: z.string().describe("Your passcode"),
  },
  async ({ username, passcode }) => {
    const res = await publicFetch("POST", "/login", { username, passcode });
    return textResult(res);
  }
);

server.tool(
  "chaprola_check_username",
  "Check if a username is available before registering",
  { username: z.string().describe("Username to check") },
  async ({ username }) => {
    const res = await publicFetch("POST", "/check-username", { username });
    return textResult(res);
  }
);

server.tool(
  "chaprola_delete_account",
  "Delete an account and all associated data. Requires passcode confirmation",
  {
    username: z.string().describe("Account username to delete"),
    passcode: z.string().describe("Account passcode for confirmation"),
  },
  async ({ username, passcode }) => {
    const res = await publicFetch("POST", "/delete-account", { username, passcode });
    return textResult(res);
  }
);

server.tool(
  "chaprola_baa_text",
  "Get the current Business Associate Agreement text and version. Present to human for review before signing",
  {},
  async () => {
    const res = await publicFetch("POST", "/baa-text", {});
    return textResult(res);
  }
);

server.tool(
  "chaprola_report",
  "Run a published program and return output. No auth required — program must be published first via /publish",
  {
    userid: z.string().describe("Owner of the published program"),
    project: z.string().describe("Project containing the program"),
    name: z.string().describe("Name of the published .PR file"),
  },
  async ({ userid, project, name }) => {
    const body: Record<string, unknown> = { userid, project, name };
    const res = await publicFetch("POST", "/report", body);
    return textResult(res);
  }
);

// ============================================================
// AUTHENTICATED ENDPOINTS
// ============================================================

// --- BAA ---

server.tool(
  "chaprola_sign_baa",
  "Sign the BAA. STOP: You MUST call chaprola_baa_text first, show the FULL text to the human, and get their EXPLICIT typed approval before calling this. Never sign automatically. Only needed for PHI — non-PHI data works without a BAA.",
  {
    signatory_name: z.string().describe("Full name of the person agreeing to the BAA"),
    signatory_title: z.string().optional().describe("Title of the signatory"),
    organization: z.string().optional().describe("Organization name (the Covered Entity)"),
  },
  async ({ signatory_name, signatory_title, organization }) => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, signatory_name };
    if (signatory_title) body.signatory_title = signatory_title;
    if (organization) body.organization = organization;
    const res = await authedFetch("/sign-baa", body);
    return textResult(res);
  }
);

server.tool(
  "chaprola_baa_status",
  "Check whether the authenticated user has signed the BAA",
  {},
  async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/baa-status", { userid: username });
    return textResult(res);
  }
);

// --- Import ---

server.tool(
  "chaprola_import",
  "Import JSON data into Chaprola format files (.F + .DA). Sign BAA first if handling PHI",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("File name (without extension)"),
    data: z.array(z.record(z.any())).describe("Array of flat JSON objects to import"),
    format: z.enum(["json", "fhir"]).optional().describe("Data format: json (default) or fhir"),
    expires_in_days: z.number().optional().describe("Days until data expires (default: 90)"),
  },
  async ({ project, name, data, format, expires_in_days }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, name, data };
    if (format) body.format = format;
    if (expires_in_days) body.expires_in_days = expires_in_days;
    const res = await authedFetch("/import", body);
    return textResult(res);
  })
);

server.tool(
  "chaprola_import_url",
  "Get a presigned S3 upload URL for large files (bypasses 6MB API Gateway limit)",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("File name (without extension)"),
  },
  async ({ project, name }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/import-url", { userid: username, project, name });
    return textResult(res);
  })
);

server.tool(
  "chaprola_import_process",
  "Process a file previously uploaded to S3 via presigned URL. Generates .F + .DA files",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("File name (without extension)"),
    format: z.enum(["json", "fhir"]).optional().describe("Data format: json (default) or fhir"),
  },
  async ({ project, name, format }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, name };
    if (format) body.format = format;
    const res = await authedFetch("/import-process", body);
    return textResult(res);
  })
);

server.tool(
  "chaprola_import_download",
  "Import data directly from a public URL (CSV, TSV, JSON, NDJSON, Parquet, Excel). Optional AI-powered schema inference",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("Output file name (without extension)"),
    url: z.string().url().describe("Public URL to download (http/https only)"),
    instructions: z.string().optional().describe("Natural language instructions for AI-powered field selection and transforms"),
    max_rows: z.number().optional().describe("Maximum rows to import (default: 5,000,000)"),
  },
  async ({ project, name, url, instructions, max_rows }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, name, url };
    if (instructions) body.instructions = instructions;
    if (max_rows) body.max_rows = max_rows;
    const res = await authedFetch("/import-download", body);
    return textResult(res);
  })
);

// --- Export ---

server.tool(
  "chaprola_export",
  "Export Chaprola .DA + .F files back to JSON",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("File name (without extension)"),
  },
  async ({ project, name }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/export", { userid: username, project, name });
    return textResult(res);
  })
);

// --- List ---

server.tool(
  "chaprola_list",
  "List files in a project with optional wildcard pattern",
  {
    project: z.string().describe("Project name (use * for all projects)"),
    pattern: z.string().optional().describe("Wildcard pattern to filter files (e.g., EMP*)"),
  },
  async ({ project, pattern }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project };
    if (pattern) body.pattern = pattern;
    const res = await authedFetch("/list", body);
    return textResult(res);
  })
);

// --- Compile ---

server.tool(
  "chaprola_compile",
  "Compile Chaprola source (.CS) to bytecode (.PR). READ chaprola://cookbook BEFORE writing source. Key syntax: no PROGRAM keyword (start with commands), no commas, MOVE+PRINT 0 buffer model (not PRINT field), SEEK for primary records, OPEN/READ/WRITE/CLOSE for secondary files, LET supports one operation (no parentheses), field addressing via P.field/S.field requires primary_format/secondary_format params.",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("Program name (without extension)"),
    source: z.string().describe("Chaprola source code"),
    primary_format: z.string().optional().describe("Primary data file name (enables P.fieldname addressing)"),
    secondary_format: z.string().optional().describe("Secondary format file name (enables S.fieldname addressing)"),
  },
  async ({ project, name, source, primary_format, secondary_format }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, name, source };
    if (primary_format) body.primary_format = primary_format;
    if (secondary_format) body.secondary_format = secondary_format;
    const res = await authedFetch("/compile", body);
    return textResult(res);
  })
);

// --- Run ---

server.tool(
  "chaprola_run",
  "Execute a compiled .PR program. Use async:true for large datasets (>100K records)",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("Program name (without extension)"),
    primary_file: z.string().optional().describe("Primary data file to load"),
    record: z.number().optional().describe("Starting record number"),
    async_exec: z.boolean().optional().describe("If true, run asynchronously and return job_id for polling"),
    secondary_files: z.array(z.string()).optional().describe("Secondary files to make available"),
    nophi: z.boolean().optional().describe("If true, obfuscate PHI-flagged fields during execution"),
  },
  async ({ project, name, primary_file, record, async_exec, secondary_files, nophi }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, name };
    if (primary_file) body.primary_file = primary_file;
    if (record !== undefined) body.record = record;
    if (async_exec !== undefined) body.async = async_exec;
    if (secondary_files) body.secondary_files = secondary_files;
    if (nophi !== undefined) body.nophi = nophi;
    const res = await authedFetch("/run", body);
    return textResult(res);
  })
);

server.tool(
  "chaprola_run_status",
  "Check status of an async job. Returns full output when done",
  {
    project: z.string().describe("Project name"),
    job_id: z.string().describe("Job ID from async /run response"),
  },
  async ({ project, job_id }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/run/status", { userid: username, project, job_id });
    return textResult(res);
  })
);

server.tool(
  "chaprola_run_each",
  "Run a compiled .PR program against every record in a data file. Like CHAPRPG from the original SCIOS. Use this for scoring, bulk updates, conditional logic across records.",
  {
    project: z.string().describe("Project name"),
    file: z.string().describe("Data file to iterate (.DA)"),
    program: z.string().describe("Compiled program name (.PR) in the same project"),
    where: z.array(z.object({
      field: z.string().describe("Field name to filter on"),
      op: z.string().describe("Operator: eq, ne, gt, ge, lt, le, between, contains, starts_with"),
      value: z.union([z.string(), z.number(), z.array(z.number())]).describe("Value to compare against"),
    })).optional().describe("Optional filter — only run against matching records"),
    where_logic: z.enum(["and", "or"]).optional().describe("How to combine multiple where conditions (default: and)"),
  },
  async ({ project, file, program, where, where_logic }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, file, program };
    if (where) body.where = where;
    if (where_logic) body.where_logic = where_logic;
    const res = await authedFetch("/run-each", body);
    return textResult(res);
  })
);

// --- Publish ---

server.tool(
  "chaprola_publish",
  "Publish a compiled program for public access via /report",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("Program name to publish"),
    primary_file: z.string().optional().describe("Data file to load when running the report"),
    record: z.number().optional().describe("Starting record number"),
  },
  async ({ project, name, primary_file, record }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, name };
    if (primary_file) body.primary_file = primary_file;
    if (record !== undefined) body.record = record;
    const res = await authedFetch("/publish", body);
    return textResult(res);
  })
);

server.tool(
  "chaprola_unpublish",
  "Remove public access from a published program",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("Program name to unpublish"),
  },
  async ({ project, name }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/unpublish", { userid: username, project, name });
    return textResult(res);
  })
);

// --- Export Report ---

server.tool(
  "chaprola_export_report",
  "Run a .PR program and save output as a persistent .R file in S3",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("Program name"),
    primary_file: z.string().optional().describe("Primary data file to load"),
    report_name: z.string().optional().describe("Custom output file name"),
    format: z.enum(["text", "pdf", "csv", "json", "xlsx"]).optional().describe("Output format (default: text)"),
    title: z.string().optional().describe("Report title (used in PDF header)"),
    nophi: z.boolean().optional().describe("If true, obfuscate PHI-flagged fields"),
  },
  async ({ project, name, primary_file, report_name, format, title, nophi }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, name };
    if (primary_file) body.primary_file = primary_file;
    if (report_name) body.report_name = report_name;
    if (format) body.format = format;
    if (title) body.title = title;
    if (nophi !== undefined) body.nophi = nophi;
    const res = await authedFetch("/export-report", body);
    return textResult(res);
  })
);

// --- Download ---

server.tool(
  "chaprola_download",
  "Get a presigned S3 URL to download any file you own (1-hour expiry)",
  {
    project: z.string().describe("Project name"),
    file: z.string().describe("File name with extension (e.g., REPORT.R)"),
    type: z.enum(["data", "format", "source", "proc", "output"]).describe("File type directory"),
  },
  async ({ project, file, type }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/download", { userid: username, project, file, type });
    return textResult(res);
  })
);

// --- Query ---

server.tool(
  "chaprola_query",
  "SQL-free data query with WHERE, SELECT, aggregation, ORDER BY, JOIN, pivot, and Mercury scoring",
  {
    project: z.string().describe("Project name"),
    file: z.string().describe("Data file to query"),
    where: z.record(z.any()).optional().describe("Filter: {field, op, value}. Ops: eq, ne, gt, ge, lt, le, between, contains, starts_with"),
    select: z.array(z.string()).optional().describe("Fields to include in output"),
    aggregate: z.array(z.record(z.any())).optional().describe("Aggregation: [{field, func}]. Funcs: count, sum, avg, min, max, stddev"),
    order_by: z.array(z.record(z.any())).optional().describe("Sort: [{field, dir}]"),
    limit: z.number().optional().describe("Max results to return"),
    offset: z.number().optional().describe("Skip this many results"),
    join: z.record(z.any()).optional().describe("Join: {file, on, type, method}"),
    pivot: z.record(z.any()).optional().describe("Pivot: {row, column, values, totals, grand_total}"),
    mercury: z.record(z.any()).optional().describe("Mercury scoring: {fields: [{field, target, weight}]}"),
  },
  async ({ project, file, where, select, aggregate, order_by, limit, offset, join, pivot, mercury }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, file };
    if (where) body.where = where;
    if (select) body.select = select;
    if (aggregate) body.aggregate = aggregate;
    if (order_by) body.order_by = order_by;
    if (limit !== undefined) body.limit = limit;
    if (offset !== undefined) body.offset = offset;
    if (join) body.join = join;
    if (pivot) body.pivot = pivot;
    if (mercury) body.mercury = mercury;
    const res = await authedFetch("/query", body);
    return textResult(res);
  })
);

// --- Sort ---

server.tool(
  "chaprola_sort",
  "Sort a data file by one or more fields. Modifies the file in place",
  {
    project: z.string().describe("Project name"),
    file: z.string().describe("Data file to sort"),
    sort_by: z.array(z.object({
      field: z.string(),
      dir: z.enum(["asc", "desc"]).optional(),
      type: z.enum(["text", "numeric"]).optional(),
    })).describe("Sort specification: [{field, dir?, type?}]"),
  },
  async ({ project, file, sort_by }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/sort", { userid: username, project, file, sort_by });
    return textResult(res);
  })
);

// --- Index ---

server.tool(
  "chaprola_index",
  "Build an index file (.IDX) for fast lookups on a field",
  {
    project: z.string().describe("Project name"),
    file: z.string().describe("Data file to index"),
    field: z.string().describe("Field name to index"),
  },
  async ({ project, file, field }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/index", { userid: username, project, file, field });
    return textResult(res);
  })
);

// --- Merge ---

server.tool(
  "chaprola_merge",
  "Merge two sorted data files into one. Both must share the same format (.F)",
  {
    project: z.string().describe("Project name"),
    file_a: z.string().describe("First data file"),
    file_b: z.string().describe("Second data file"),
    output: z.string().describe("Output file name"),
    key: z.string().describe("Merge key field"),
  },
  async ({ project, file_a, file_b, output, key }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/merge", { userid: username, project, file_a, file_b, output, key });
    return textResult(res);
  })
);

// --- Schema: Format + Alter ---

server.tool(
  "chaprola_format",
  "Inspect a data file's schema — returns field names, positions, lengths, types, and PHI flags",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("Data file name (without .F extension)"),
  },
  async ({ project, name }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/format", { userid: username, project, name });
    return textResult(res);
  })
);

server.tool(
  "chaprola_alter",
  "Modify a data file's schema: widen/narrow/rename fields, add new fields, drop fields. Transforms existing data to match the new schema.",
  {
    project: z.string().describe("Project name"),
    name: z.string().describe("Data file name (without extension)"),
    alter: z.array(z.object({
      field: z.string().describe("Field name to modify"),
      width: z.number().optional().describe("New width (widen or narrow)"),
      rename: z.string().optional().describe("New field name"),
      type: z.enum(["text", "numeric"]).optional().describe("Change field type"),
    })).optional().describe("Fields to alter"),
    add: z.array(z.object({
      name: z.string().describe("New field name"),
      width: z.number().describe("Field width"),
      type: z.enum(["text", "numeric"]).optional().describe("Field type (default: text)"),
      after: z.string().optional().describe("Insert after this field (default: end)"),
    })).optional().describe("Fields to add"),
    drop: z.array(z.string()).optional().describe("Field names to drop"),
    output: z.string().optional().describe("Output file name (default: in-place)"),
  },
  async ({ project, name, alter, add, drop, output }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, name };
    if (alter) body.alter = alter;
    if (add) body.add = add;
    if (drop) body.drop = drop;
    if (output) body.output = output;
    const res = await authedFetch("/alter", body);
    return textResult(res);
  })
);

// --- Optimize (HULDRA) ---

server.tool(
  "chaprola_optimize",
  "Run HULDRA nonlinear optimization using a compiled .PR as the objective evaluator",
  {
    project: z.string().describe("Project name"),
    program: z.string().describe("Compiled .PR program name (the VALUE program)"),
    primary_file: z.string().describe("Data file to pass to the VALUE program"),
    elements: z.array(z.object({
      index: z.number().describe("R-variable index (1-20)"),
      label: z.string(),
      start: z.number(),
      min: z.number(),
      max: z.number(),
      delta: z.number(),
    })).describe("Parameters to optimize"),
    objectives: z.array(z.object({
      index: z.number().describe("R-variable index (1-20) — maps to R(20+index)"),
      label: z.string(),
      goal: z.number(),
      weight: z.number(),
    })).describe("Objective values to minimize"),
    max_iterations: z.number().optional().describe("Max iterations (default: 100)"),
    h_initial: z.number().optional().describe("Initial step fraction (default: 0.125)"),
    async_exec: z.boolean().optional().describe("If true, return job_id for long optimizations"),
  },
  async ({ project, program, primary_file, elements, objectives, max_iterations, h_initial, async_exec }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { userid: username, project, program, primary_file, elements, objectives };
    if (max_iterations !== undefined) body.max_iterations = max_iterations;
    if (h_initial !== undefined) body.h_initial = h_initial;
    if (async_exec !== undefined) body.async = async_exec;
    const res = await authedFetch("/optimize", body);
    return textResult(res);
  })
);

server.tool(
  "chaprola_optimize_status",
  "Check status of an async optimization job",
  {
    project: z.string().describe("Project name"),
    job_id: z.string().describe("Job ID from async /optimize response"),
  },
  async ({ project, job_id }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/optimize/status", { userid: username, project, job_id });
    return textResult(res);
  })
);

// --- Email ---

server.tool(
  "chaprola_email_inbox",
  "List emails in the authenticated user's mailbox",
  {
    limit: z.number().optional().describe("Max emails to return (default 20, max 100)"),
    before: z.string().optional().describe("ISO 8601 timestamp — return emails before this time"),
  },
  async ({ limit, before }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { address: username };
    if (limit !== undefined) body.limit = limit;
    if (before) body.before = before;
    const res = await authedFetch("/email/inbox", body);
    return textResult(res);
  })
);

server.tool(
  "chaprola_email_read",
  "Read a specific email by message_id",
  {
    message_id: z.string().describe("Message ID from inbox listing"),
  },
  async ({ message_id }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/email/read", { address: username, message_id });
    return textResult(res);
  })
);

server.tool(
  "chaprola_email_send",
  "Send an email from your @chaprola.org address. Subject to content moderation",
  {
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject"),
    text: z.string().describe("Plain text body"),
    html: z.string().optional().describe("HTML body"),
    from: z.string().optional().describe("Sender local part (default: your username)"),
  },
  async ({ to, subject, text, html, from }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const body: Record<string, unknown> = { from: from || username, to, subject, text };
    if (html) body.html = html;
    const res = await authedFetch("/email/send", body);
    return textResult(res);
  })
);

server.tool(
  "chaprola_email_delete",
  "Delete a specific email from your mailbox",
  {
    message_id: z.string().describe("Message ID to delete"),
  },
  async ({ message_id }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/email/delete", { address: username, message_id });
    return textResult(res);
  })
);

// --- Search ---

server.tool(
  "chaprola_search",
  "Search the web via Brave Search API. Returns titles, URLs, and snippets. Optional AI-grounded summary. Rate limit: 10/day per user",
  {
    query: z.string().describe("Search query string"),
    count: z.number().optional().describe("Number of results to return (default 5, max 20)"),
    summarize: z.boolean().optional().describe("Include AI-grounded summary from Brave Answers API"),
  },
  async ({ query, count, summarize }) => withBaaCheck(async () => {
    const body: Record<string, unknown> = { query };
    if (count !== undefined) body.count = count;
    if (summarize !== undefined) body.summarize = summarize;
    const res = await authedFetch("/search", body);
    return textResult(res);
  })
);

// --- Fetch ---

server.tool(
  "chaprola_fetch",
  "Fetch any URL and return clean content. HTML pages converted to markdown. SSRF-protected. Rate limit: 20/day per user",
  {
    url: z.string().url().describe("URL to fetch (http:// or https://)"),
    format: z.enum(["markdown", "text", "html", "json"]).optional().describe("Output format (default: markdown)"),
    max_length: z.number().optional().describe("Max output characters (default: 50000, max: 200000)"),
  },
  async ({ url, format, max_length }) => withBaaCheck(async () => {
    const body: Record<string, unknown> = { url };
    if (format) body.format = format;
    if (max_length !== undefined) body.max_length = max_length;
    const res = await authedFetch("/fetch", body);
    return textResult(res);
  })
);

// --- Schedule ---

server.tool(
  "chaprola_schedule",
  "Create a scheduled job that runs a Chaprola endpoint on a recurring cron. Max 10 schedules/user, 15-min minimum interval",
  {
    name: z.string().describe("Unique name for this schedule (alphanumeric + hyphens/underscores)"),
    cron: z.string().describe("Standard 5-field cron expression (min hour day month weekday). Minimum interval: 15 minutes"),
    endpoint: z.enum(["/import-download", "/run", "/export-report", "/search", "/fetch", "/query", "/email/send", "/export", "/report", "/list"]).describe("Target endpoint to call"),
    body: z.record(z.any()).describe("Request body for the target endpoint. userid is injected automatically"),
    skip_if_unchanged: z.boolean().optional().describe("Skip when response matches previous run (SHA-256 hash). Default: false"),
  },
  async ({ name, cron, endpoint, body, skip_if_unchanged }) => withBaaCheck(async () => {
    const reqBody: Record<string, unknown> = { name, cron, endpoint, body };
    if (skip_if_unchanged !== undefined) reqBody.skip_if_unchanged = skip_if_unchanged;
    const res = await authedFetch("/schedule", reqBody);
    return textResult(res);
  })
);

server.tool(
  "chaprola_schedule_list",
  "List all scheduled jobs for the authenticated user with run history and next execution time",
  {},
  async () => withBaaCheck(async () => {
    const res = await authedFetch("/schedule/list", {});
    return textResult(res);
  })
);

server.tool(
  "chaprola_schedule_delete",
  "Delete a scheduled job by name",
  {
    name: z.string().describe("Name of the schedule to delete"),
  },
  async ({ name }) => withBaaCheck(async () => {
    const res = await authedFetch("/schedule/delete", { name });
    return textResult(res);
  })
);

// --- Record CRUD ---

server.tool(
  "chaprola_insert_record",
  "Insert a new record into a data file's merge file (.MRG). The record appears at the end of the file until consolidation.",
  {
    project: z.string().describe("Project name"),
    file: z.string().describe("Data file name (without extension)"),
    record: z.record(z.string()).describe("Field name → value pairs. Unspecified fields default to blanks."),
  },
  async ({ project, file, record }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/insert-record", { userid: username, project, file, record });
    return textResult(res);
  })
);

server.tool(
  "chaprola_update_record",
  "Update fields in a single record matched by a where clause. If no sort-key changes, updates in place; otherwise marks old record ignored and appends to merge file.",
  {
    project: z.string().describe("Project name"),
    file: z.string().describe("Data file name (without extension)"),
    where: z.record(z.string()).describe("Field name → value pairs to identify exactly one record"),
    set: z.record(z.string()).describe("Field name → new value pairs to update"),
  },
  async ({ project, file, where: whereClause, set }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/update-record", { userid: username, project, file, where: whereClause, set });
    return textResult(res);
  })
);

server.tool(
  "chaprola_delete_record",
  "Delete a single record matched by a where clause. Marks the record as ignored (.IGN). Physically removed on consolidation.",
  {
    project: z.string().describe("Project name"),
    file: z.string().describe("Data file name (without extension)"),
    where: z.record(z.string()).describe("Field name → value pairs to identify exactly one record"),
  },
  async ({ project, file, where: whereClause }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/delete-record", { userid: username, project, file, where: whereClause });
    return textResult(res);
  })
);

server.tool(
  "chaprola_consolidate",
  "Merge a .MRG file into its parent .DA, producing a clean sorted data file. Deletes .MRG and .IGN after success. Aborts if .MRG was modified during the operation.",
  {
    project: z.string().describe("Project name"),
    file: z.string().describe("Data file name (without extension)"),
  },
  async ({ project, file }) => withBaaCheck(async () => {
    const { username } = getCredentials();
    const res = await authedFetch("/consolidate", { userid: username, project, file });
    return textResult(res);
  })
);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
