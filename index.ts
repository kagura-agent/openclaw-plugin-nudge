import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { join } from "path";

// File-based audit log for nudge observability
// Addresses the "nudge observability black hole" — console.log doesn't reliably
// appear in journalctl, so we can't verify nudge is firing without this.
const AUDIT_LOG_FILENAME = ".nudge-audit.log";
const MAX_AUDIT_LINES = 200;

function auditLog(workspaceDir: string, message: string): void {
  const logPath = join(workspaceDir, AUDIT_LOG_FILENAME);
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} ${message}\n`;
  try {
    appendFileSync(logPath, entry);
    // Trim if too long (keep last MAX_AUDIT_LINES lines)
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      if (lines.length > MAX_AUDIT_LINES) {
        writeFileSync(logPath, lines.slice(-MAX_AUDIT_LINES).join("\n") + "\n");
      }
    }
  } catch {
    // Best-effort logging — don't break the plugin
  }
}

// State file for persisting turn counter across gateway restarts
const STATE_FILENAME = ".nudge-state.json";

interface NudgeState {
  turnCount: number;
  lastNudgeAt: number;
}

interface NudgeConfig {
  interval?: number;
  promptFile?: string;
  prompt?: string;
  mode?: "system-event" | "subagent";
  skipTriggers?: string[];
  skipSessionPatterns?: string[];
}

function loadState(workspaceDir: string): NudgeState {
  const statePath = join(workspaceDir, STATE_FILENAME);
  try {
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, "utf-8"));
    }
  } catch {
    // Corrupted state file — reset
  }
  return { turnCount: 0, lastNudgeAt: 0 };
}

function saveState(workspaceDir: string, state: NudgeState): void {
  const statePath = join(workspaceDir, STATE_FILENAME);
  try {
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[nudge] Failed to save state:", err);
  }
}

function loadPrompt(workspaceDir: string, config: NudgeConfig): string | null {
  // Inline prompt takes priority
  if (config.prompt) return config.prompt;

  // Try promptFile
  const promptFile = config.promptFile ?? "NUDGE.md";
  const promptPath = join(workspaceDir, promptFile);
  try {
    if (existsSync(promptPath)) {
      const content = readFileSync(promptPath, "utf-8").trim();
      // Skip if effectively empty (only headers and whitespace)
      const meaningful = content.replace(/^#+\s.*$/gm, "").trim();
      if (meaningful.length > 0) return content;
    }
  } catch {
    // File not readable
  }

  // Default prompt
  return `Review the recent conversation. Consider:
1. Has the user revealed preferences, expectations, or personal details worth remembering? If so, update memory files.
2. Were there ideas, insights, or lessons learned that should be captured? If so, write them down.
3. Were there commitments made that haven't been tracked? If so, add them to the daily memory file.
If nothing worth saving, say "Nothing to save." and stop.`;
}

export default function register(api: any) {
  const config: NudgeConfig = api.config?.plugins?.entries?.nudge?.config ?? {};
  const interval = config.interval ?? 10;
  const mode = config.mode ?? "subagent";
  const skipTriggers = new Set(config.skipTriggers ?? ["heartbeat", "cron"]);
  const skipSessionPatterns: string[] = config.skipSessionPatterns ?? [];

  api.on(
    "agent_end",
    async (
      event: { messages: unknown[]; success: boolean },
      ctx: {
        agentId?: string;
        sessionKey?: string;
        workspaceDir?: string;
        trigger?: string;
      },
    ) => {
      // Skip failed runs
      if (!event.success) return;

      // Skip if trigger should be ignored (heartbeat, cron, etc.)
      if (ctx.trigger && skipTriggers.has(ctx.trigger)) {
        if (ctx.workspaceDir) auditLog(ctx.workspaceDir, `Skipped (trigger=${ctx.trigger})`);
        return;
      }

      // Skip if session key matches any skip pattern (e.g. dreaming sessions)
      if (ctx.sessionKey && skipSessionPatterns.length > 0) {
        const matchedPattern = skipSessionPatterns.find(p => ctx.sessionKey!.includes(p));
        if (matchedPattern) {
          if (ctx.workspaceDir) auditLog(ctx.workspaceDir, `Skipped (sessionPattern=${matchedPattern}, session=${ctx.sessionKey})`);
          return;
        }
      }

      // Need workspace to persist state
      const workspaceDir = ctx.workspaceDir;
      if (!workspaceDir) return;

      // Load and increment counter
      const state = loadState(workspaceDir);
      state.turnCount++;

      // Check if it's time to nudge
      if (state.turnCount < interval) {
        saveState(workspaceDir, state);
        return;
      }

      // Time to nudge! Reset counter
      state.turnCount = 0;
      state.lastNudgeAt = Date.now();
      saveState(workspaceDir, state);

      // Load the nudge prompt
      const prompt = loadPrompt(workspaceDir, config);
      if (!prompt) return;

      // Log the nudge
      const logMsg = `Triggering reflection (mode=${mode}, interval=${interval}, session=${ctx.sessionKey})`;
      console.log(`[nudge] ${logMsg}`);
      auditLog(workspaceDir, logMsg);

      try {
        if (api.runtime?.system?.enqueueSystemEvent) {
          // Inject as a system event into the session queue
          // This is processed on the next session turn
          api.runtime.system.enqueueSystemEvent(prompt, {
            sessionKey: ctx.sessionKey!,
            contextKey: "nudge-reflection",
          });
          console.log("[nudge] System event enqueued successfully");
          auditLog(workspaceDir, "System event enqueued successfully");
        } else {
          console.warn(
            "[nudge] No runtime API available. " +
            "Checked: api.runtime.system.enqueueSystemEvent",
          );
        }
      } catch (err) {
        console.error("[nudge] Failed to trigger reflection:", err);
        auditLog(workspaceDir, `FAILED: ${err}`);
      }
    },
    { priority: -10 }, // Low priority — run after other hooks
  );

  // Also log skipped turns for full visibility
  // (counter increments are visible in state file, but skip reasons aren't)

  // Log startup
  console.log(
    `[nudge] Plugin loaded (mode=${mode}, interval=${interval}, skipTriggers=${[...skipTriggers].join(",")}, skipSessionPatterns=${skipSessionPatterns.join(",") || "none"})`,
  );
}
