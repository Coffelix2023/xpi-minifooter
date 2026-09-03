import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configPath, parseConfig, saveConfig } from "./config.js";
import { openGlimpsePanel } from "./panel.js";
import { SessionRuntime, wireSession } from "./session.js";
import { openTuiModal } from "./tui-modal.js";

export default function xpiMinifooter(pi: ExtensionAPI): void {
  const runtime = new SessionRuntime();
  wireSession(pi, runtime);

  pi.registerCommand("xpi-minifooter", {
    description: "Open the xpi-minifooter config panel",
    handler: async (_args, ctx) => {
      const result = await openGlimpsePanel(runtime.config);
      if (result.outcome === "saved") {
        // Node 端复用校验管线: JSON 是 YAML 子集, fail-closed 一致
        const valid = parseConfig(JSON.stringify(result.config));
        if (valid !== null) {
          saveConfig(configPath(), valid);
          runtime.applyConfig(valid);
        }
        return;
      }
      if (result.outcome === "unavailable") {
        // Glimpse 不可用 → TUI modal fallback(task 4.3); 返回 false 表示连 custom 也没有
        const shown = await openTuiModal(ctx, runtime.config);
        if (!shown) {
          ctx.ui.notify(
            "xpi-minifooter: no UI backend available; edit ~/.pi/agent/minifooter.yml directly",
            "warning",
          );
        }
      }
      // cancelled: 不落盘, 无操作
    },
  });
}
