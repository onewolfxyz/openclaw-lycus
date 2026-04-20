import type {
  OpenClawConfig,
} from "openclaw/plugin-sdk/channel-core";

import { pairMachine, probeBackend, sendBackendMessage } from "./client.js";
import { CHANNEL_ID, CHANNEL_LABEL, DEFAULT_ACCOUNT_ID } from "./constants.js";
import {
  clawChannelConfigSchema,
  inspectClawChannelAccount,
  isClawChannelConfigured,
  listClawChannelAccountIds,
  resolveClawChannelAccount,
  upsertAccountConfig,
  validateAccountInput,
} from "./config.js";
import type { ClawChannelAccount } from "./types.js";

type ChannelPlugin<TAccount> = Record<string, unknown> & {
  config?: {
    resolveAccount?: (
      cfg: OpenClawConfig,
      accountId?: string | null,
    ) => TAccount;
  };
};

type ChannelOutboundContext = {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  replyToId?: string | null;
  threadId?: string | number | null;
  accountId?: string | null;
};

type ChannelOutboundPayloadContext = ChannelOutboundContext & {
  payload: unknown;
};

export const clawChannelPlugin = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: CHANNEL_LABEL,
    selectionLabel: CHANNEL_LABEL,
    detailLabel: "Claw Channel Backend",
    blurb:
      "Connect OpenClaw to the Claw Channel backend through a paired machine token.",
    aliases: ["claw", "clawchannel"],
    markdownCapable: true,
    quickstartAllowFrom: true,
    showConfigured: true,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    blockStreaming: true,
    media: true,
  },
  configSchema: clawChannelConfigSchema,
  config: {
    listAccountIds: listClawChannelAccountIds,
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    resolveAccount: resolveClawChannelAccount,
    inspectAccount: inspectClawChannelAccount,
    isEnabled: (account: ClawChannelAccount) => account.enabled,
    disabledReason: () => "Claw Channel account is disabled.",
    isConfigured: isClawChannelConfigured,
    unconfiguredReason: () =>
      "Configure channels.claw-channel.baseUrl and channels.claw-channel.machineToken.",
    resolveAllowFrom: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }) =>
      resolveClawChannelAccount(cfg, accountId).allowFrom,
    resolveDefaultTo: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }) =>
      resolveClawChannelAccount(cfg, accountId).defaultTo,
    describeAccount: (account: ClawChannelAccount) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: isClawChannelConfigured(account),
      running: false,
      connected: false,
      details: {
        baseUrl: account.baseUrl,
        machineId: account.machineId,
      },
    }),
  },
  setup: {
    applyAccountConfig: ({
      cfg,
      accountId,
      input,
    }: {
      cfg: OpenClawConfig;
      accountId: string;
      input: Record<string, unknown>;
    }) => upsertAccountConfig(cfg, accountId, input),
    validateInput: ({
      input,
    }: {
      cfg: OpenClawConfig;
      accountId: string;
      input: Record<string, unknown>;
    }) => validateAccountInput(input),
  },
  security: {
    resolveDmPolicy: ({ account }: { account: ClawChannelAccount }) => ({
      policy: account.dmPolicy,
      allowFrom: account.allowFrom,
    }),
  },
  pairing: {
    idLabel: "Claw Channel sender id",
    normalizeAllowEntry: (entry: string) => entry.trim().toLowerCase(),
    notifyApproval: async ({
      cfg,
      id,
      accountId,
    }: {
      cfg: OpenClawConfig;
      id: string;
      accountId?: string;
    }) => {
      const account = resolveClawChannelAccount(cfg, accountId);
      await sendBackendMessage(account, {
        accountId: account.accountId,
        machineId: account.machineId,
        conversationId: id,
        text: "Your OpenClaw pairing request was approved.",
      });
    },
  },
  threading: {
    topLevelReplyToMode: "reply",
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    chunkerMode: "markdown",
    sendText: async (ctx: ChannelOutboundContext) => {
      const account = resolveClawChannelAccount(ctx.cfg, ctx.accountId);
      const result = await sendBackendMessage(account, {
        accountId: account.accountId,
        machineId: account.machineId,
        conversationId: ctx.to,
        text: ctx.text,
        threadId: ctx.threadId,
        replyToId: ctx.replyToId,
      });

      return { messageId: result.messageId };
    },
    sendMedia: async (ctx: ChannelOutboundContext) => {
      const account = resolveClawChannelAccount(ctx.cfg, ctx.accountId);
      const result = await sendBackendMessage(account, {
        accountId: account.accountId,
        machineId: account.machineId,
        conversationId: ctx.to,
        text: ctx.text,
        mediaUrl: ctx.mediaUrl,
        threadId: ctx.threadId,
        replyToId: ctx.replyToId,
      });

      return { messageId: result.messageId };
    },
    sendPayload: async (ctx: ChannelOutboundPayloadContext) => {
      const account = resolveClawChannelAccount(ctx.cfg, ctx.accountId);
      const text = extractPayloadText(ctx.payload) || ctx.text;
      const result = await sendBackendMessage(account, {
        accountId: account.accountId,
        machineId: account.machineId,
        conversationId: ctx.to,
        text,
        threadId: ctx.threadId,
        replyToId: ctx.replyToId,
        payload: ctx.payload,
      });

      return { messageId: result.messageId };
    },
  },
  auth: {
    login: async ({
      cfg,
      accountId,
      channelInput,
    }: {
      cfg: OpenClawConfig;
      accountId?: string | null;
      channelInput?: string | null;
    }) => {
      const account = resolveClawChannelAccount(cfg, accountId);
      const pairAccount = channelInput
        ? { ...account, machineToken: channelInput }
        : account;
      await pairMachine(pairAccount);
    },
  },
  gateway: {
    startAccount: async ({
      account,
      getStatus,
      setStatus,
      log,
    }: {
      account: ClawChannelAccount;
      getStatus: () => Record<string, unknown>;
      setStatus: (status: Record<string, unknown>) => void;
      log?: { info?: (message: string) => void; warn?: (message: string) => void };
    }) => {
      setStatus({
        ...getStatus(),
        running: true,
        connected: isClawChannelConfigured(account),
        configured: isClawChannelConfigured(account),
      });

      if (account.pairOnStart && isClawChannelConfigured(account)) {
        try {
          const paired = await pairMachine(account);
          log?.info?.(
            `${CHANNEL_LABEL}: paired account ${paired.accountId} (${paired.machineId ?? "unassigned"})`,
          );
        } catch (error) {
          log?.warn?.(
            `${CHANNEL_LABEL}: pairing failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        }
      }
    },
    stopAccount: async ({
      getStatus,
      setStatus,
    }: {
      getStatus: () => Record<string, unknown>;
      setStatus: (status: Record<string, unknown>) => void;
    }) => {
      setStatus({
        ...getStatus(),
        running: false,
        connected: false,
      });
    },
  },
  status: {
    defaultRuntime: {
      running: false,
      connected: false,
    },
    probeAccount: async ({
      account,
    }: {
      account: ClawChannelAccount;
      timeoutMs: number;
      cfg: OpenClawConfig;
    }) => probeBackend(account),
    buildAccountSnapshot: ({
      account,
      probe,
    }: {
      account: ClawChannelAccount;
      probe?: { ok?: boolean; message?: string };
    }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: isClawChannelConfigured(account),
      running: true,
      connected: Boolean(probe?.ok),
      details: {
        baseUrl: account.baseUrl,
        machineId: account.machineId,
        backend: probe?.ok ? "reachable" : probe?.message ?? "not probed",
      },
    }),
  },
} as unknown as ChannelPlugin<ClawChannelAccount>;

function extractPayloadText(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const maybeText = (payload as Record<string, unknown>).text;
    if (typeof maybeText === "string") return maybeText;
  }

  return "";
}
