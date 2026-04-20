export { clawChannelPlugin } from "./src/channel.js";
export {
  CHANNEL_ID,
  CHANNEL_LABEL,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_INBOUND_PATH,
} from "./src/constants.js";
export {
  resolveClawChannelAccount,
  listClawChannelAccountIds,
} from "./src/config.js";
export type {
  ClawChannelAccount,
  ClawChannelBackendMessage,
  ClawChannelBackendIndicator,
  ClawChannelInboundEvent,
  ClawChannelOutboundMessage,
  ClawChannelPairResponse,
} from "./src/types.js";
