import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  configPath,
  type MinifooterConfig,
  parseConfigWithError,
  saveConfig,
} from "./config.js";
import { openGlimpsePanel, type PanelDeps, type PanelResult } from "./panel.js";
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

export interface PanelSaveDeps {
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
  respond?: (message: { ok: boolean; message: string }) => void,
): boolean {
  const raw = "rawYaml" in result ? result.rawYaml : JSON.stringify(result.config);
  const parsed = parseConfigWithError(raw);
  if (parsed.config === null) {
    const message = `xpi-minifooter: ${parsed.error ?? "invalid configuration"}`;
    notify(message);
    respond?.({
      ok: false,
      message,
    });
    return false;
  }
  try {
    deps.save(deps.path, parsed.config);
  } catch (error) {
    const message = `xpi-minifooter: failed to save configuration: ${String(error)}`;
    notify(message);
    respond?.({
      ok: false,
      message,
    });
    return false;
  }
  runtime.applyConfig(parsed.config);
  respond?.({
    message: "xpi-minifooter: configuration applied",
    ok: true,
  });
  return true;
}

export async function runMinifooterCommand(
  runtime: SessionRuntime,
  ctx: {
    ui: {
      notify(message: string, kind?: string): void;
    };
  },
  deps: {
    openPanel?: typeof openGlimpsePanel;
    openFallback?: (
      ctx: {
        ui: {
          notify(message: string, kind?: string): void;
        };
      },
      config: MinifooterConfig,
    ) => Promise<boolean>;
    save?: PanelSaveDeps;
  } = {},
) {
  const notifyError = (message: string) => ctx.ui.notify(message, "error");
  const apply = (
    result: Exclude<
      PanelResult,
      | {
          outcome: "cancelled";
        }
      | {
          outcome: "unavailable";
        }
    >,
    respond?: (message: { ok: boolean; message: string }) => void,
  ) =>
    deps.save === undefined
      ? applyPanelConfig(runtime, result, notifyError, undefined, respond)
      : applyPanelConfig(runtime, result, notifyError, deps.save, respond);
  refreshConfigBeforePanel(runtime, (message) => ctx.ui.notify(message, "warning"));
  const result = await (deps.openPanel ?? openGlimpsePanel)(runtime.config, {
    nativeStatuses: runtime.nativeStatuses,
    onApply: apply,
  } satisfies PanelDeps);
  if (result.outcome === "saved") {
    apply(result);
    return;
  }
  if (result.outcome !== "unavailable") return;
  const shown = await (deps.openFallback ?? openTuiModal)(ctx as never, runtime.config);
  if (!shown) {
    ctx.ui.notify(
      "xpi-minifooter: no UI backend available; edit ~/.pi/agent/minifooter.yml directly",
      "warning",
    );
  }
}

export default function xpiMinifooter(pi: ExtensionAPI): void {
  const runtime = new SessionRuntime();
  wireSession(pi, runtime);

  pi.registerCommand("xpi-minifooter", {
    description: "Open the xpi-minifooter config panel",
    handler: async (_args, ctx) => {
      await runMinifooterCommand(runtime, ctx);
    },
  });
}
