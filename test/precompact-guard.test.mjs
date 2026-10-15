import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GUARD = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../hooks/precompact-guard.mjs",
);

function runGuard(event, env = {}) {
  const result = spawnSync(process.execPath, [GUARD], {
    input: typeof event === "string" ? event : JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return result;
}

function freshDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xsai-guard-"));
}

// Parse stdout strictly: the hook contract requires exactly one JSON object.
function parseStdout(result) {
  const text = result.stdout.trim();
  assert.notEqual(text, "", "guard must always print JSON on stdout");
  const lines = text.split("\n").filter(Boolean);
  assert.equal(lines.length, 1, `expected one JSON line, got ${lines.length}`);
  return JSON.parse(lines[0]);
}

test("blocks the first automatic compaction and explains the options", () => {
  const data = freshDataDir();
  const r = runGuard({ trigger: "auto", session_id: "s1" }, { PLUGIN_DATA: data });
  assert.equal(r.status, 0);
  const out = parseStdout(r);
  assert.equal(out.continue, false);
  assert.match(out.systemMessage, /交接/);
  assert.match(out.systemMessage, /\/compact/);
  assert.ok(out.stopReason);
});

test("allows the next automatic compaction so the user is never trapped", () => {
  const data = freshDataDir();
  runGuard({ trigger: "auto", session_id: "s2" }, { PLUGIN_DATA: data });
  const second = runGuard({ trigger: "auto", session_id: "s2" }, { PLUGIN_DATA: data });
  assert.equal(second.status, 0);
  assert.deepEqual(parseStdout(second), { continue: true });
});

test("asks again in a later episode after allowing once", () => {
  const data = freshDataDir();
  runGuard({ trigger: "auto", session_id: "s3" }, { PLUGIN_DATA: data }); // ask
  runGuard({ trigger: "auto", session_id: "s3" }, { PLUGIN_DATA: data }); // allow, clears
  const third = runGuard({ trigger: "auto", session_id: "s3" }, { PLUGIN_DATA: data });
  assert.equal(parseStdout(third).continue, false, "a new episode must ask again");
});

test("sessions do not interfere with each other", () => {
  const data = freshDataDir();
  runGuard({ trigger: "auto", session_id: "a" }, { PLUGIN_DATA: data });
  const other = runGuard({ trigger: "auto", session_id: "b" }, { PLUGIN_DATA: data });
  assert.equal(parseStdout(other).continue, false, "session b must still be asked");
});

test("never blocks a manual compaction", () => {
  const data = freshDataDir();
  const r = runGuard({ trigger: "manual", session_id: "s4" }, { PLUGIN_DATA: data });
  assert.equal(r.status, 0);
  assert.deepEqual(parseStdout(r), { continue: true });
});

test("fails open on malformed or unknown input", () => {
  const data = freshDataDir();
  for (const input of ["", "not json", "null", "[]", "{}"]) {
    const r = runGuard(input, { PLUGIN_DATA: data });
    assert.equal(r.status, 0, `must exit 0 for input: ${input}`);
    const out = parseStdout(r);
    assert.equal(out.continue, true, `must fail open for input: ${input}`);
  }
});

test("survives an unusable state directory by failing open", () => {
  // A regular file where a directory is expected: mkdir fails fast and the
  // guard must still answer with valid JSON instead of crashing or hanging.
  const blockfile = path.join(freshDataDir(), "not-a-dir");
  fs.writeFileSync(blockfile, "x");
  const r = runGuard({ trigger: "auto", session_id: "s5" }, { PLUGIN_DATA: blockfile });
  assert.equal(r.status, 0);
  assert.equal(parseStdout(r).continue, true, "cannot track state => never trap the user");
});

test("a broken session_id does not break the guard", () => {
  const data = freshDataDir();
  const r = runGuard({ trigger: "auto", session_id: "../../etc/passwd" }, { PLUGIN_DATA: data });
  assert.equal(r.status, 0);
  assert.equal(parseStdout(r).continue, false);
  // Marker must stay inside the state directory.
  const stateDir = path.join(data, "precompact-state");
  for (const name of fs.readdirSync(stateDir)) {
    assert.ok(!name.includes(".."), `unsafe marker name: ${name}`);
    assert.ok(!name.includes("/") && !name.includes("\\"), `unsafe marker name: ${name}`);
    assert.ok(path.resolve(stateDir, name).startsWith(path.resolve(stateDir) + path.sep),
      `marker escaped the state dir: ${name}`);
  }
});
