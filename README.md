# openclaw-plugin-nudge

Periodic self-reflection plugin for [OpenClaw](https://github.com/nicepkg/openclaw). Hooks into `agent_end` events and triggers a reflection nudge every N agent turns, prompting the agent to review recent conversations and capture insights, preferences, and commitments to memory.

Inspired by [Hermes agent](https://github.com/nicepkg/hermes-agent)'s background review mechanism.

## How It Works

1. After each successful agent turn, the plugin increments a counter (persisted in `.nudge-state.json` in your workspace).
2. When the counter reaches the configured interval (default: 10 turns), a nudge prompt is injected as a **system event** into the current session.
3. The agent then processes the nudge on its next turn — reviewing the conversation and updating memory files as needed.
4. Turns triggered by heartbeat or cron are skipped by default (configurable via `skipTriggers`).

## Installation

Copy or symlink this directory into your OpenClaw plugins directory:

```bash
cp -r openclaw-plugin-nudge ~/.openclaw/plugins/nudge
```

Then enable it in your OpenClaw config (`~/.openclaw/config.yaml`):

```yaml
plugins:
  entries:
    nudge:
      enabled: true
      config:
        interval: 5
```

## Configuration

All fields are optional. Defined in `openclaw.plugin.json`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `interval` | number | `10` | Trigger a nudge every N agent turns |
| `promptFile` | string | `"NUDGE.md"` | Path to a file containing the nudge prompt (relative to workspace) |
| `prompt` | string | — | Inline nudge prompt (overrides `promptFile`) |
| `mode` | string | `"system-event"` | How to trigger reflection. Currently only `system-event` is supported |
| `skipTriggers` | string[] | `["heartbeat", "cron"]` | Skip nudge when agent run was initiated by these triggers |

### Mode

Currently only **`system-event`** mode is implemented. This injects the nudge prompt into the main session's event queue, so the agent processes it on the next turn within the same session context.

> **Note:** The `subagent` mode (spawning a background agent for reflection) is not yet implemented. If you set `mode: "subagent"`, it will fall back to `system-event` behavior.

## NUDGE.md

The nudge prompt can be customized by placing a `NUDGE.md` file in your workspace root. This file is read each time a nudge fires (unless overridden by the inline `prompt` config).

If `NUDGE.md` doesn't exist or is empty, a sensible default prompt is used that asks the agent to:
1. Capture user preferences and personal details worth remembering
2. Save ideas, insights, or lessons learned
3. Track commitments that haven't been recorded yet

You can tailor `NUDGE.md` to your agent's personality and workflow — for example, focusing on specific memory files, triggering TODO reviews, or prompting belief updates.

## State Persistence

The turn counter is stored in `<workspace>/.nudge-state.json`. This file is created automatically and survives gateway restarts. You can safely delete it to reset the counter.

## License

MIT
