#!/usr/bin/env node
// xsai-handoff: cross-platform session handoff store.
//
// Saves handoff documents to a fixed, OS-neutral location and lets a fresh
// session claim the most recent one for the current project (falling back to
// the most recent handoff anywhere).
//
// Dependency-free. Node.js 18+.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HANDOFF_DIRNAME = ".xsai";
const HANDOFF_SUBDIR = "handoffs";
const TEMP_FALLBACK = "xsai-handoffs";

// Resolve the handoff directory in an OS-neutral way.
// Precedence: explicit env override > user home > temp dir fallback.
export function resolveHandoffDir({ env = process.env, home = os.homedir() } = {}) {
  if (env && env.XSAI_HANDOFF_DIR) return path.resolve(env.XSAI_HANDOFF_DIR);
  if (home) return path.join(home, HANDOFF_DIRNAME, HANDOFF_SUBDIR);
  return path.join(os.tmpdir(), TEMP_FALLBACK);
}

// Normalize a path for comparison. Windows paths are case-insensitive, so
// fold case there to avoid false negatives from drive-letter casing.
export function normalizePath(p) {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isAncestorOrSelf(a, b) {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  return na === nb || nb.startsWith(na + path.sep) || na.startsWith(nb + path.sep);
}

// Walk up from cwd looking for a .git entry and read the origin remote.
// Returns { root, remote } or nulls. Never throws.
export function detectGit(cwd) {
  let current = path.resolve(cwd);
  for (;;) {
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) {
      let remote = null;
      try {
        const configPath = path.join(gitPath, "config");
        if (fs.statSync(gitPath).isDirectory() && fs.existsSync(configPath)) {
          const config = fs.readFileSync(configPath, "utf8");
          const match = /\[remote "origin"\][^\[]*?url\s*=\s*(.+)/.exec(config);
          if (match) remote = match[1].trim();
        }
      } catch {
        // A missing or unreadable config is not fatal; keep the root.
      }
      return { root: current, remote };
    }
    const parent = path.dirname(current);
    if (parent === current) return { root: null, remote: null };
    current = parent;
  }
}

export function slugify(input, maxLength = 40) {
  const slug = String(input || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "handoff";
  return slug.length > maxLength ? slug.slice(0, maxLength).replace(/-+$/g, "") : slug;
}

function timestampForFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

// Minimal front-matter reader for the flat scalar keys this skill writes.
export function parseFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ""));
  if (!match) return null;
  const fields = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let value = line.slice(idx + 1).trim();
    if (value === "" || value === "null" || value === "~") {
      value = null;
    } else {
      value = value.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");
    }
    fields[key] = value;
  }
  return fields;
}

function buildFrontMatter({ now, topic, cwd, git }) {
  const quote = (value) => (value == null ? "null" : `"${String(value).replace(/"/g, '\\"')}"`);
  return [
    "---",
    `created: ${now.toISOString()}`,
    `topic: ${quote(topic)}`,
    `project: ${quote(git.root ? path.basename(git.root) : path.basename(cwd))}`,
    `cwd: ${quote(path.resolve(cwd))}`,
    `git_root: ${quote(git.root)}`,
    `git_remote: ${quote(git.remote)}`,
    "---",
  ].join("\n");
}

const BODY_TEMPLATE = `
# 会话交接

## 任务目标

## 当前状态

## 关键决策与理由

## 已完成工作

## 剩余任务 / 下一步

## 已知坑

## 相关文件与链接

## 建议技能
`;

export function createHandoffFile({ dir, topic, cwd = process.cwd(), now = new Date(), fsImpl = fs }) {
  const git = detectGit(cwd);
  const projectSlug = slugify(git.root ? path.basename(git.root) : path.basename(cwd));
  const topicSlug = slugify(topic || "session");
  const filename = `${timestampForFilename(now)}-${projectSlug}-${topicSlug}.md`;
  fsImpl.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  // Avoid clobbering a handoff created in the same second.
  let finalPath = filePath;
  let counter = 2;
  while (fsImpl.existsSync(finalPath)) {
    finalPath = path.join(dir, filename.replace(/\.md$/, `-${counter}.md`));
    counter += 1;
  }
  const frontMatter = buildFrontMatter({ now, topic, cwd, git });
  fsImpl.writeFileSync(finalPath, `${frontMatter}\n${BODY_TEMPLATE}`);
  return { path: finalPath, dir, git };
}

export function listHandoffs(dir, { fsImpl = fs } = {}) {
  let names;
  try {
    names = fsImpl.readdirSync(dir);
  } catch {
    return [];
  }
  const entries = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const filePath = path.join(dir, name);
    let stat;
    let text;
    try {
      stat = fsImpl.statSync(filePath);
      if (!stat.isFile()) continue;
      text = fsImpl.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontMatter(text) || {};
    entries.push({
      file: name,
      path: filePath,
      created: fm.created || stat.mtime.toISOString(),
      topic: fm.topic || null,
      project: fm.project || null,
      cwd: fm.cwd || null,
      gitRoot: fm.git_root || null,
      gitRemote: fm.git_remote || null,
    });
  }
  entries.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return entries;
}

export function matchesProject(entry, cwd) {
  if (!cwd) return false;
  for (const candidate of [entry.cwd, entry.gitRoot]) {
    if (!candidate) continue;
    try {
      if (isAncestorOrSelf(candidate, cwd)) return true;
    } catch {
      // Ignore malformed recorded paths.
    }
  }
  return false;
}

export function pickLatest(entries, cwd) {
  if (!entries.length) return null;
  const matched = entries.filter((entry) => matchesProject(entry, cwd));
  const pool = matched.length ? matched : entries;
  return { entry: pool[0], scope: matched.length ? "project" : "global" };
}

// Patterns for values that must be redacted before a handoff is written.
// Kept deliberately narrow to avoid flagging ordinary prose.
const SECRET_PATTERNS = [
  ["api-key", /\b(?:sk-[A-Za-z0-9_-]{12,}|xsai_operator_[A-Za-z0-9_-]{6,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,})/g],
  ["bearer-token", /\bBearer\s+[A-Za-z0-9._-]{16,}/g],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["assign-secret", /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"',]{8,}/gi],
  ["cn-id", /(?<!\d)\d{17}[\dXx](?!\d)/g],
  ["cn-mobile", /(?<!\d)1[3-9]\d{9}(?!\d)/g],
];

export function scanSecrets(text) {
  const findings = [];
  for (const [kind, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(String(text || ""))) !== null) {
      if (match[0].includes("<redacted:")) continue;
      findings.push({ kind, sample: match[0].slice(0, 4) + "***" });
    }
  }
  return findings;
}

export function scanFile(filePath, { fsImpl = fs } = {}) {
  return scanSecrets(fsImpl.readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0] || "dir";
  const dir = resolveHandoffDir();
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const json = Boolean(args.json);

  if (command === "dir") {
    fs.mkdirSync(dir, { recursive: true });
    process.stdout.write(`${dir}\n`);
    return 0;
  }

  if (command === "new") {
    const result = createHandoffFile({ dir, topic: args.topic, cwd });
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`${result.path}\n`);
    return 0;
  }

  if (command === "list") {
    const entries = listHandoffs(dir);
    if (json) {
      process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
    } else if (!entries.length) {
      process.stdout.write("no handoffs\n");
    } else {
      for (const entry of entries) {
        process.stdout.write(`${entry.created}\t${entry.project || "-"}\t${entry.file}\n`);
      }
    }
    return 0;
  }

  if (command === "latest") {
    const picked = pickLatest(listHandoffs(dir), cwd);
    if (!picked) {
      process.stderr.write("no handoffs found\n");
      return 1;
    }
    if (json) process.stdout.write(`${JSON.stringify(picked, null, 2)}\n`);
    else process.stdout.write(`${picked.entry.path}\n`);
    return 0;
  }

  if (command === "check") {
    const target = args.file ? path.resolve(args.file) : (pickLatest(listHandoffs(dir), cwd) || {}).entry?.path;
    if (!target) {
      process.stderr.write("no handoff file to check\n");
      return 1;
    }
    const findings = scanFile(target);
    if (json) {
      process.stdout.write(`${JSON.stringify({ file: target, findings }, null, 2)}\n`);
    } else if (!findings.length) {
      process.stdout.write(`clean: ${target}\n`);
    } else {
      for (const finding of findings) process.stdout.write(`${finding.kind}\t${finding.sample}\n`);
    }
    return findings.length ? 1 : 0;
  }

  process.stderr.write(`unknown command: ${command}\n`);
  return 2;
}

// Only run the CLI when invoked directly, so the helpers stay importable in tests.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
