import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  configPath,
  type MinifooterConfig,
  parseConfigWithError,
  saveConfig,
} from "./config.js";
import { openGlimpsePanel, type PanelResult } from "./panel.js";
import { SessionRuntime, wireSession } from "./session.js";
import { openTuiModal } from "./tui-modal.js";

export function refreshConfigBeforePanel(
  runtime: Pick<SessionRuntime, "maybeReload">,
  notify: (message: string) => void,
): void {
  runtime.maybeReload(notify);
}

interface PanelRuntime {
  applyConfig(config: MinifooterConfig): void;
}

interface PanelSaveDeps {
  path: string;
  save: typeof saveConfig;
}

export function applyPanelConfig(
  runtime: PanelRuntime,
  result: Exclude<
    PanelResult,
    | {
        outcome: "cancelled";
      }
    | {
        outcome: "unavailable";
      }
  >,
  notify: (message: string) => void,
  deps: PanelSaveDeps = {
    path: configPath(),
    save: saveConfig,
  },
): boolean {
  const raw = "rawYaml" in result ? result.rawYaml : JSON.stringify(result.config);
  const parsed = parseConfigWithError(raw);
  if (parsed.config === null) {
    notify(`xpi-minifooter: ${parsed.error ?? "invalid configuration"}`);
    return false;
  }
  deps.save(deps.path, parsed.config);
  runtime.applyConfig(parsed.config);
  return true;
}

export default function xpiMinifooter(pi: ExtensionAPI): void {
  const runtime = new SessionRuntime();
  wireSession(pi, runtime);

  pi.registerCommand("xpi-minifooter", {
    description: "Open the xpi-minifooter config panel",
    handler: async (_args, ctx) => {
      refreshConfigBeforePanel(runtime, (message) => ctx.ui.notify(message, "warning"));
      const result = await openGlimpsePanel(runtime.config);
      if (result.outcome === "saved") {
        applyPanelConfig(runtime, result, (message) => ctx.ui.notify(message, "error"));
        return;
      }
      if (result.outcome === "unavailable") {
        const shown = await openTuiModal(ctx, runtime.config);
        if (!shown) {
          ctx.ui.notify(
            "xpi-minifooter: no UI backend available; edit ~/.pi/agent/minifooter.yml directly",
            "warning",
          );
        }
      }
    },
  });
}
