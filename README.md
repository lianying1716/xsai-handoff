# xsai-handoff

星算会话交接技能。把一个长会话压缩成结构化交接文档，存到本机固定位置；新会话说一句「继续上次」，就能自动认领最近一份接着干。

解决的是长对话超上下文、换会话丢关键细节的问题：任务目标、关键决策、已完成、剩余任务、已知坑、相关文件都会带过去。

## 安装

把仓库根目录复制到宿主的 skills 目录，例如：

- Codex：`~/.codex/skills/xsai-handoff`
- Claude Code：`~/.claude/skills/xsai-handoff`
- 跨运行时别名：`~/.agents/skills/xsai-handoff`

要求 Node.js 18 或更新版本，无第三方依赖。

## 用法

存一份：

```bash
node scripts/handoff.mjs new --topic "支付回调调试"
```

列出历史：

```bash
node scripts/handoff.mjs list
```

写入后做脱敏自检（有命中就改成占位符，直到输出 `clean`）：

```bash
node scripts/handoff.mjs check
```

认领最近一份（先匹配当前项目，再退回全局）：

```bash
node scripts/handoff.mjs latest --cwd "$PWD"
```

打印存放目录：

```bash
node scripts/handoff.mjs dir
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
