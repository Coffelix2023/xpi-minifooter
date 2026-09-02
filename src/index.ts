import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const VERSION = "0.1.0";

export default function xpiMinifooter(pi: ExtensionAPI): void {
  pi.registerCommand("xpi-minifooter", {
    description: "Show xpi-minifooter status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`xpi-minifooter ${VERSION} loaded`);
    },
  });
}
