import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveHandoffDir,
  normalizePath,
  slugify,
  parseFrontMatter,
  createHandoffFile,
  listHandoffs,
  matchesProject,
  pickLatest,
  scanSecrets,
} from "../scripts/handoff.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xsai-handoff-test-"));
}

function makeProject(name) {
  const root = path.join(tempDir(), name);
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".git", "config"),
    `[remote "origin"]\n\turl = git@github.com:example/${name}.git\n`,
  );
  return root;
}

test("resolveHandoffDir prefers explicit env override", () => {
  const dir = resolveHandoffDir({ env: { XSAI_HANDOFF_DIR: "/custom/handoff" }, home: "/home/u" });
  assert.equal(dir, path.resolve("/custom/handoff"));
});

test("resolveHandoffDir uses home .xsai/handoffs by default", () => {
  const dir = resolveHandoffDir({ env: {}, home: "/home/ztb" });
  assert.equal(dir, path.join("/home/ztb", ".xsai", "handoffs"));
});

test("resolveHandoffDir falls back to temp dir when home is unavailable", () => {
  const dir = resolveHandoffDir({ env: {}, home: "" });
  assert.equal(dir, path.join(os.tmpdir(), "xsai-handoffs"));
});

test("slugify keeps unicode letters and strips punctuation", () => {
  assert.equal(slugify("会话 交接: v2!"), "会话-交接-v2");
  assert.equal(slugify("   "), "handoff");
  assert.ok(slugify("x".repeat(80)).length <= 40);
});

test("parseFrontMatter reads flat scalar fields", () => {
  const fm = parseFrontMatter('---\ncreated: 2026-10-09T00:00:00.000Z\ntopic: "a: b"\ngit_root: null\n---\nbody');
  assert.equal(fm.created, "2026-10-09T00:00:00.000Z");
  assert.equal(fm.topic, "a: b");
  assert.equal(fm.git_root, null);
});

test("createHandoffFile writes a document with front matter and a stable name", () => {
  const dir = tempDir();
  const project = makeProject("demo-project");
  const now = new Date("2026-10-09T12:34:56Z");
  const result = createHandoffFile({ dir, topic: "会话交接", cwd: project, now });

  assert.ok(fs.existsSync(result.path));
  assert.equal(path.basename(result.path), "20261009-123456-demo-project-会话交接.md");
  assert.equal(result.git.root, project);
  assert.equal(result.git.remote, "git@github.com:example/demo-project.git");
  const text = fs.readFileSync(result.path, "utf8");
  assert.match(text, /## 剩余任务 \/ 下一步/);
  assert.match(text, /## 建议技能/);
});

test("createHandoffFile does not clobber same-second handoffs", () => {
  const dir = tempDir();
  const project = makeProject("demo");
  const now = new Date("2026-10-09T12:34:56Z");
  const first = createHandoffFile({ dir, topic: "a", cwd: project, now });
  const second = createHandoffFile({ dir, topic: "a", cwd: project, now });
  assert.notEqual(first.path, second.path);
  assert.equal(listHandoffs(dir).length, 2);
});

test("listHandoffs returns newest first and tolerates a missing dir", () => {
  const dir = tempDir();
  const project = makeProject("demo");
  createHandoffFile({ dir, topic: "old", cwd: project, now: new Date("2026-10-01T00:00:00Z") });
  createHandoffFile({ dir, topic: "new", cwd: project, now: new Date("2026-10-09T00:00:00Z") });
  const entries = listHandoffs(dir);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].topic, "new");
  assert.deepEqual(listHandoffs(path.join(dir, "missing")), []);
});

test("pickLatest prefers a handoff from the current project", () => {
  const dir = tempDir();
  const alpha = makeProject("alpha");
  const beta = makeProject("beta");
  createHandoffFile({ dir, topic: "beta-newer", cwd: beta, now: new Date("2026-10-09T10:00:00Z") });
  createHandoffFile({ dir, topic: "alpha-older", cwd: alpha, now: new Date("2026-10-08T10:00:00Z") });
  const picked = pickLatest(listHandoffs(dir), alpha);
  assert.equal(picked.scope, "project");
  assert.equal(picked.entry.topic, "alpha-older");
});

test("pickLatest falls back to the newest handoff globally", () => {
  const dir = tempDir();
  const alpha = makeProject("alpha");
  const beta = makeProject("beta");
  createHandoffFile({ dir, topic: "beta-newer", cwd: beta, now: new Date("2026-10-09T10:00:00Z") });
  const picked = pickLatest(listHandoffs(dir), alpha);
  assert.equal(picked.scope, "global");
  assert.equal(picked.entry.topic, "beta-newer");
});

test("pickLatest handles an empty store", () => {
  assert.equal(pickLatest([], "/tmp"), null);
});

test("matchesProject matches a subdirectory of the recorded project", () => {
  const dir = tempDir();
  const project = makeProject("alpha");
  createHandoffFile({ dir, topic: "x", cwd: project, now: new Date("2026-10-09T00:00:00Z") });
  const [entry] = listHandoffs(dir);
  assert.equal(matchesProject(entry, path.join(project, "src", "deep")), true);
});

test("normalizePath is idempotent", () => {
  assert.equal(normalizePath(normalizePath("/a/b/../b")), path.resolve("/a/b"));
});

test("scanSecrets flags credentials and PII", () => {
  const text = [
    "token xsai_operator_9f3c8a71d4e5b6a7",
    "Authorization: Bearer abcdefghijklmnop1234",
    "password= hunter2secret",
    "id 11010519900307123X",
    "call 13812345678",
    "-----BEGIN RSA PRIVATE KEY-----",
  ].join("\n");
  const kinds = new Set(scanSecrets(text).map((f) => f.kind));
  assert.ok(kinds.has("api-key"));
  assert.ok(kinds.has("bearer-token"));
  assert.ok(kinds.has("assign-secret"));
  assert.ok(kinds.has("cn-id"));
  assert.ok(kinds.has("cn-mobile"));
  assert.ok(kinds.has("private-key"));
});

test("scanSecrets leaves a clean handoff alone", () => {
  const text = "# 交接\n\n## 已完成工作\n- 提交 commit a1b2c3d，单测通过\n- 用 <redacted:api-key> 占位\n";
  assert.deepEqual(scanSecrets(text), []);
});

test("scanSecrets does not flag ordinary numbers", () => {
  assert.deepEqual(scanSecrets("QPS 上限 20，超时 3000ms，端口 8080"), []);
});

test("a malformed created date is treated as corrupt, not authoritative", () => {
  const dir = tempDir();
  const project = makeProject("demo");
  createHandoffFile({ dir, topic: "real", cwd: project, now: new Date("2026-10-09T00:00:00Z") });
  fs.writeFileSync(
    path.join(dir, "zz-plan.md"),
    '---\ncreated: "not-a-date"\ntopic: junk\n---\n\n# just a note\n',
  );
  const entries = listHandoffs(dir);
  const junk = entries.find((e) => e.topic === "junk");
  assert.equal(junk.valid, false, "unparseable created must be flagged invalid");
  // Even with a fresher mtime, the corrupt file must not be served as latest.
  assert.equal(pickLatest(entries, project).entry.topic, "real");
});

test("pickLatest ignores stray non-handoff markdown in the store", () => {
  const dir = tempDir();
  const project = makeProject("demo");
  createHandoffFile({ dir, topic: "real", cwd: project, now: new Date("2026-10-01T00:00:00Z") });
  // A stray README with no front matter, written later, must not win.
  fs.writeFileSync(path.join(dir, "2026-10-09-notes.md"), "# 随手记\nnothing to do with handoff\n");
  const picked = pickLatest(listHandoffs(dir), project);
  assert.equal(picked.entry.topic, "real");
  assert.equal(picked.entry.valid, true);
});

test("pickLatest still returns something when only malformed files exist", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "a.md"), "# loose note\n");
  const picked = pickLatest(listHandoffs(dir), "/tmp");
  assert.ok(picked, "must not return null when files exist");
  assert.equal(picked.entry.valid, false);
});
