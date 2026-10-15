# xsai-handoff

星算会话交接技能。把一个长会话压缩成结构化交接文档，存到本机固定位置；新会话说一句「继续上次」，就能自动认领最近一份接着干。

解决的是长对话超上下文、换会话丢关键细节的问题：任务目标、关键决策、已完成、剩余任务、已知坑、相关文件都会带过去。

同时带一个 `PreCompact` 钩子：Codex 即将**自动**压缩历史前会先停下来询问你，而不是静默丢失细节。

## 安装（Codex 插件）

以插件形式安装，技能与钩子一起生效：

```bash
codex plugin marketplace add lianying1716/xsai-handoff
codex plugin add xsai-handoff@xsai-handoff
```

安装后按提示在 `/hooks` 中 review 并信任钩子；不信任时技能仍可用，只是不会拦截自动压缩。

## 安装（仅技能）

把仓库根目录复制到宿主的 skills 目录，例如：

- Codex：`~/.codex/skills/xsai-handoff`
- Claude Code：`~/.claude/skills/xsai-handoff`
- 跨运行时别名：`~/.agents/skills/xsai-handoff`

源目录是 `skills/xsai-handoff/`。这种方式只有技能，没有 PreCompact 拦截。

要求 Node.js 18 或更新版本，无第三方依赖。

## 用法

存一份：

```bash
node scripts/handoff.mjs new --topic "支付回调调试"
node skills/xsai-handoff/scripts/handoff.mjs new --topic "支付回调调试"
```

列出历史：

```bash
node skills/xsai-handoff/scripts/handoff.mjs list
```

写入后做脱敏自检（有命中就改成占位符，直到输出 `clean`）：

```bash
node skills/xsai-handoff/scripts/handoff.mjs check
```

认领最近一份（先匹配当前项目，再退回全局）：

```bash
node skills/xsai-handoff/scripts/handoff.mjs latest --cwd "$PWD"
```

打印存放目录：

```bash
node skills/xsai-handoff/scripts/handoff.mjs dir
```

## 目录结构

```
.codex-plugin/plugin.json      插件清单（skills + hooks）
skills/xsai-handoff/           技能本体（SKILL.md、脚本、模板）
hooks/hooks.json               PreCompact 接线（matcher: auto）
hooks/precompact-guard.mjs     上下文快满时拦一次并询问
```

## 存放位置

- Windows：`%USERPROFILE%\.xsai\handoffs`
- macOS / Linux：`$HOME/.xsai/handoffs`

可用 `XSAI_HANDOFF_DIR` 覆盖。文档不会写进被交接的项目仓库。

## 测试

```bash
node --test test/
```

## 许可

MIT
