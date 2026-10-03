import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const imports = join(root, "imports");
const headers = "guardian_name,guardian_email,athlete_name,group_reference,enrollment_start,athlete_reference\n";

test("valid quoted CSV passes, and review errors never echo private names or emails", async () => {
  await mkdir(imports, { recursive: true });
  const folder = await mkdtemp(join(imports, "validator-test-"));
  try {
    const good = join(folder, "valid.csv");
    await writeFile(good, headers + '"Parent, Example",parent@example.test,"Athlete, Example",Foundational,2026-10-01,one\n');
    const result = spawnSync(process.execPath, ["scripts/validate-roster.mjs", good], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Rows reviewed: 1/);

    const bad = join(folder, "review.csv");
    await writeFile(bad, headers +
      "Parent Example,parent@example.test,Athlete Example,Advanced,2026-02-30,one\n" +
      "Parent Example,parent@example.test,Athlete Example,Advanced,2026-10-01,one\n");
    const review = spawnSync(process.execPath, ["scripts/validate-roster.mjs", bad], { cwd: root, encoding: "utf8" });
    assert.equal(review.status, 1);
    assert.match(review.stdout, /ERROR line 2: enrollment_start/);
    assert.match(review.stdout, /REVIEW line 3: athlete_reference/);
    assert.doesNotMatch(review.stdout + review.stderr, /Parent Example|Athlete Example|parent@example\.test/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("validator refuses a CSV outside the ignored imports folder", async () => {
  const folder = await mkdtemp(join(tmpdir(), "roster-test-"));
  try {
    const file = join(folder, "roster.csv");
    await writeFile(file, headers);
    await mkdir(imports, { recursive: true });
    const result = spawnSync(process.execPath, ["scripts/validate-roster.mjs", file], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Git-ignored imports/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
