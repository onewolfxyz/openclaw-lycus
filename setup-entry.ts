import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { clawChannelPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(clawChannelPlugin);
