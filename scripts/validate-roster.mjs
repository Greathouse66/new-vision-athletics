import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const privateFolder = resolve(root, "imports");
const required = ["guardian_name", "guardian_email", "athlete_name", "group_reference", "enrollment_start"];
const allowedGroups = new Set(["foundational", "post-bigs", "advanced"]);

function parseCsv(source) {
  const rows = [];
  let cells = [];
  let value = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;
  const input = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  function finishRow() {
    cells.push(value);
    if (cells.some((cell) => cell.trim())) rows.push({ line: rowLine, cells });
    cells = [];
    value = "";
    afterQuote = false;
    rowLine = line + 1;
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        value += char;
      }
    } else if (char === "," || char === "\n") {
      if (char === "\n") finishRow();
      else {
        cells.push(value);
        value = "";
        afterQuote = false;
      }
    } else if (char === '"' && !afterQuote && value === "") {
      quoted = true;
    } else if (char === '"' || (afterQuote && char !== " " && char !== "\t")) {
      throw new Error(`Invalid CSV quoting near line ${line}`);
    } else if (!afterQuote) {
      value += char;
    }
    if (char === "\n") line++;
  }
  if (quoted) throw new Error(`Unclosed CSV quote near line ${rowLine}`);
  if (cells.length || value || afterQuote) finishRow();
  return rows;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function validate(rows) {
  if (!rows.length) throw new Error("CSV has no header row");
  const headers = rows[0].cells.map((name) => name.trim());
  if (new Set(headers).size !== headers.length || headers.includes("")) {
    throw new Error("CSV header names must be nonempty and unique");
  }
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`Missing required headers: ${missing.join(", ")}`);

  const issues = [];
  const seenReferences = new Map();
  const seenNames = new Map();
  let count = 0;
  for (const row of rows.slice(1)) {
    count++;
    if (row.cells.length !== headers.length) {
      issues.push(`ERROR line ${row.line}: expected ${headers.length} columns, found ${row.cells.length}`);
      continue;
    }
    const record = Object.fromEntries(headers.map((name, i) => [name, row.cells[i].trim()]));
    for (const name of required) {
      if (!record[name]) issues.push(`ERROR line ${row.line}: missing ${name}`);
    }
    if (record.guardian_email && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(record.guardian_email)) {
      issues.push(`ERROR line ${row.line}: invalid guardian_email format`);
    }
    if (record.group_reference && !allowedGroups.has(record.group_reference.toLowerCase())) {
      issues.push(`ERROR line ${row.line}: group_reference needs review against the three confirmed groups`);
    }
    if (record.enrollment_start && !validDate(record.enrollment_start)) {
      issues.push(`ERROR line ${row.line}: enrollment_start must be a real YYYY-MM-DD date`);
    }
    if (record.enrollment_end && (!validDate(record.enrollment_end) ||
      (validDate(record.enrollment_start) && record.enrollment_end <= record.enrollment_start))) {
      issues.push(`ERROR line ${row.line}: enrollment_end must be a later YYYY-MM-DD date`);
    }
    const athleteRef = record.athlete_reference;
    if (athleteRef) {
      if (seenReferences.has(athleteRef)) {
        issues.push(`REVIEW line ${row.line}: athlete_reference also occurs on line ${seenReferences.get(athleteRef)}`);
      } else seenReferences.set(athleteRef, row.line);
    }
    const nameKey = `${record.guardian_email?.toLowerCase()}\0${record.athlete_name?.toLowerCase()}`;
    if (record.guardian_email && record.athlete_name) {
      if (seenNames.has(nameKey)) {
        issues.push(`REVIEW line ${row.line}: guardian and athlete name also occur on line ${seenNames.get(nameKey)}`);
      } else seenNames.set(nameKey, row.line);
    }
  }
  return { count, issues };
}

async function main() {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/validate-roster.mjs imports/roster.csv");
  const folder = await realpath(privateFolder).catch(() => {
    throw new Error("Create the Git-ignored imports/ folder first");
  });
  const file = await realpath(resolve(process.cwd(), process.argv[2])).catch(() => {
    throw new Error("CSV file not found; place it inside the Git-ignored imports/ folder");
  });
  const within = relative(folder, file);
  if (within.startsWith("..") || isAbsolute(within) || !within) {
    throw new Error("Place the private CSV inside the Git-ignored imports/ folder");
  }
  if ((await stat(file)).size > 2_000_000) throw new Error("CSV exceeds the 2 MB review limit");
  const rows = parseCsv(await readFile(file, "utf8"));
  const { count, issues } = validate(rows);
  console.log(`Rows reviewed: ${count}`);
  for (const issue of issues) console.log(issue);
  console.log("No database records were changed. Review every flagged row before import.");
  if (issues.some((issue) => issue.startsWith("ERROR"))) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
