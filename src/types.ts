export type ClawChannelDmPolicy = "pairing" | "allowlist" | "open" | "disabled";
export type ClawChannelChatType = "direct" | "group";

export type ClawChannelApiPaths = {
  pairPath?: string;
  messagesPath?: string;
  indicatorsPath?: string;
  healthPath?: string;
};

export type ClawChannelAccountConfig = {
  enabled?: boolean;
  baseUrl?: string;
  machineToken?: string;
  machineId?: string;
  machineName?: string;
  gatewayPublicUrl?: string;
  inboundPath?: string;
  webhookSecret?: string;
  defaultTo?: string;
  dmPolicy?: ClawChannelDmPolicy;
  allowFrom?: string[];
  pairOnStart?: boolean;
  blockStreaming?: boolean;
  api?: ClawChannelApiPaths;
};

export type ClawChannelConfigSection = ClawChannelAccountConfig & {
  accounts?: Record<string, ClawChannelAccountConfig>;
};

export type ClawChannelAccount = Required<
  Pick<
    ClawChannelAccountConfig,
    | "enabled"
    | "inboundPath"
    | "dmPolicy"
    | "allowFrom"
    | "pairOnStart"
    | "blockStreaming"
  >
> &
  Pick<
    ClawChannelAccountConfig,
    | "baseUrl"
    | "machineToken"
    | "machineId"
    | "machineName"
    | "gatewayPublicUrl"
    | "webhookSecret"
    | "defaultTo"
  > & {
    accountId: string;
    api: Required<ClawChannelApiPaths>;
  };

export type ClawChannelBackendMessage = {
  type?: "message";
  id?: string;
  messageId?: string;
  conversationId?: string;
  to?: string;
  from?: string;
  senderId?: string;
  senderName?: string;
  text?: string;
  body?: string;
  chatType?: ClawChannelChatType;
  threadId?: string | number | null;
  replyToId?: string | null;
  timestamp?: number | string;
  sessionKey?: string;
  conversationLabel?: string;
  accountId?: string;
  channelData?: Record<string, unknown>;
};

export type ClawChannelBackendIndicator = {
  type: "typing" | "read" | "delivered" | "ping";
  id?: string;
  conversationId?: string;
  from?: string;
  senderId?: string;
  accountId?: string;
  timestamp?: number | string;
  channelData?: Record<string, unknown>;
};

export type ClawChannelInboundEvent =
  | ClawChannelBackendMessage
  | ClawChannelBackendIndicator
  | {
      type: "batch";
      accountId?: string;
      events: Array<ClawChannelBackendMessage | ClawChannelBackendIndicator>;
    };

export type ClawChannelOutboundMessage = {
  accountId: string;
  machineId?: string;
  conversationId: string;
  text: string;
  messageId?: string;
  threadId?: string | number | null;
  replyToId?: string | null;
  kind?: string;
  mediaUrl?: string;
  payload?: unknown;
  channelData?: Record<string, unknown>;
};

export type ClawChannelOutboundIndicator = {
  accountId: string;
  machineId?: string;
  conversationId: string;
  type: "typing" | "typing_stopped" | "error";
  messageId?: string;
  threadId?: string | number | null;
  text?: string;
  channelData?: Record<string, unknown>;
};

export type ClawChannelPairResponse = {
  ok: boolean;
  accountId: string;
  machineId?: string;
  paired?: boolean;
  message?: string;
};
