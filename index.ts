import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { clawChannelPlugin, registerRuntimeApi } from "./src/channel.js";
import { CHANNEL_ID, CHANNEL_LABEL } from "./src/constants.js";
import type { RuntimeApi } from "./src/inbound.js";

export default defineChannelPluginEntry({
  id: CHANNEL_ID,
  name: CHANNEL_LABEL,
  description:
    "Channel plugin that connects OpenClaw to Lycus.",
  plugin: clawChannelPlugin,
  registerFull(api: RuntimeApi) {
    registerRuntimeApi(api);
  },
});
