#!/usr/bin/env node
// PreCompact guard for xsai-handoff.
//
// Goal: right before Codex AUTOMATICALLY compacts the history, stop and ask the
// user, instead of silently summarizing away detail.
//
// Wiring is in ./hooks.json: matcher "auto" means only automatic compaction is
// intercepted; a user-typed /compact is "manual" and is left alone.
//
// Codex contract:
//   stdin  = hook event JSON (must be consumed)
//   stdout = {"continue": false, "systemMessage": "..."} to stop before compacting
//   exit 0 = success; non-zero is reported to the user as a hook failure
//
// ---------------------------------------------------------------------------
// Why the "ask once" state exists.
//
// If the guard always returned continue:false, a session that is already over
// the limit would be blocked on every following turn and the user would be
// trapped with no way forward. So each compaction episode asks exactly once:
//
//   attempt 1 -> block + explain the options
//   attempt 2 -> allow (the user has been told; they chose to go on)
//
// After allowing, the marker is cleared so a later episode asks again.
// ---------------------------------------------------------------------------
//
// Reliability rules (a broken hook breaks every session, so fail open):
//   1. Always exit 0.
//   2. Always print exactly one valid JSON object on stdout.
//   3. Never throw: every step is guarded; any internal failure -> allow.
//   4. No network, no dependencies. Only touches its own state directory.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MESSAGE = [
  "上下文快满：Codex 即将自动压缩本次会话的历史。",
  "压缩会把细节合并掉，所以先停下来问你一句。请选一个：",
  "  1) 说「交接一下」—— 先把目标 / 决策 / 待办 / 已知坑存成交接文档，细节不丢（推荐）",
  "  2) 输入 /compact —— 你自己确认压缩，我不再拦",
  "  3) 直接再发一条消息 —— 视为同意，我会自动压缩后继续",
].join("\n");

function allow() {
  process.stdout.write(JSON.stringify({ continue: true }) + "\n");
}

function block() {
  process.stdout.write(
    JSON.stringify({
      continue: false,
      systemMessage: MESSAGE,
      stopReason: "上下文快满：等待用户决定是否先存交接",
    }) + "\n",
  );
}

function readEvent() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function stateDir() {
  // PLUGIN_DATA is provided when the hook ships inside a plugin. Fall back to a
  // temp directory so a standalone hooks.json install still works.
  const base = process.env.PLUGIN_DATA || path.join(os.tmpdir(), "xsai-handoff");
  const dir = path.join(base, "precompact-state");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(value) {
  // Replace path separators and collapse dots so the result can never contain
  // "..", which keeps the marker strictly inside the state directory.
  return String(value || "unknown")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[._]+/, "_")
    .slice(0, 120);
}

function main() {
  const event = readEvent();
  const trigger = typeof event.trigger === "string" ? event.trigger : "";

  // Only automatic compaction is guarded. Anything else gets out of the way.
  if (trigger !== "auto") return allow();

  let marker;
  try {
    marker = path.join(stateDir(), `asked-${safeName(event.session_id)}`);
  } catch {
    // Cannot track state => never risk trapping the user.
    return allow();
  }

  try {
    if (fs.existsSync(marker)) {
      // Already asked in this episode: let the user's decision through.
      try {
        fs.rmSync(marker, { force: true });
      } catch {
        // Ignore: failing to clear only means we ask again next time.
      }
      return allow();
    }
    fs.writeFileSync(marker, new Date().toISOString(), { flag: "wx" });
    return block();
  } catch (error) {
    // "wx" fails if another hook instance won the race: it already asked, so the
    // user has been notified. Otherwise treat any error as fail-open.
    if (error && error.code === "EEXIST") return allow();
    return allow();
  }
}

try {
  main();
} catch {
  allow();
}
process.exit(0);
