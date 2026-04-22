import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";

import { clawChannelPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(clawChannelPlugin);
