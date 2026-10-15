<!--
Canonical trigger directive for the xsai-handoff skill. The 星算 desktop installer
reads THIS file from the skill directory and injects it into the host agent's
persistent instructions (Codex AGENTS.md / Claude Code CLAUDE.md) inside a marker
block keyed by the plugin id, so uninstall removes exactly this block.
Keep it short and front-load the trigger words.
-->
## 会话交接 —— 用 `xsai-handoff`

用户说「交接」「handoff」「压缩上下文」「换个会话继续」「存个交接」时，
用 `xsai-handoff` 把当前会话存成交接文档；说「继续上次」「接续」「resume」
时，用本技能认领最近一份交接再继续。

- 先跑 `handoff.mjs new --topic "<主题>"` 生成骨架，填完后跑 `check` 确认脱敏干净。
- 交接文档写到本机 `~/.xsai/handoffs/`，不要写进被交接的项目仓库。
- 上下文快满、准备换会话前，主动提议先存一份交接，不要直接丢掉细节。
