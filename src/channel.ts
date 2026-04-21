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
import { registerInboundRoute, type RuntimeApi } from "./inbound.js";
import { clawChannelSetupWizard } from "./setup-wizard.js";
import type { ClawChannelAccount } from "./types.js";
import { ClawChannelWebSocketSession } from "./websocket.js";

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

type GatewayStartContext = {
  account: ClawChannelAccount;
  getStatus: () => Record<string, unknown>;
  setStatus: (status: Record<string, unknown>) => void;
  cfg?: OpenClawConfig;
  config?: OpenClawConfig;
  runtime?: RuntimeApi["runtime"];
  log?: {
    debug?: (message: string) => void;
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
};

const websocketSessions = new Map<string, ClawChannelWebSocketSession>();
let runtimeApi: RuntimeApi | undefined;

export const clawChannelPlugin = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: CHANNEL_LABEL,
    selectionLabel: CHANNEL_LABEL,
    detailLabel: "Lycus Backend",
    blurb:
      "Connect OpenClaw to Lycus through a paired machine token.",
    aliases: ["lycus", "lycusai"],
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
    disabledReason: () => "Lycus account is disabled.",
    isConfigured: isClawChannelConfigured,
    unconfiguredReason: () =>
      "Configure channels.lycus.baseUrl, channels.lycus.machineToken, and channels.lycus.machineId.",
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
        mode: account.mode,
        baseUrl: account.baseUrl,
        socketUrl: account.socketUrl,
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
  setupWizard: clawChannelSetupWizard,
  security: {
    resolveDmPolicy: ({ account }: { account: ClawChannelAccount }) => ({
      policy: account.dmPolicy,
      allowFrom: account.allowFrom,
    }),
  },
  pairing: {
    idLabel: "Lycus sender id",
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
        text: "Your Lycus pairing request was approved.",
        assistant: account.assistant,
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
        assistant: account.assistant,
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
        assistant: account.assistant,
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
        assistant: account.assistant,
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
    startAccount: async (ctx: GatewayStartContext) => {
      const { account, getStatus, setStatus, log } = ctx;
      setStatus({
        ...getStatus(),
        running: true,
        connected: false,
        configured: isClawChannelConfigured(account),
        mode: account.mode,
      });

      if (account.mode === "websocket" && isClawChannelConfigured(account)) {
        const api = resolveRuntimeApi(ctx);
        if (!api) {
          log?.warn?.(`${CHANNEL_LABEL}: OpenClaw runtime API is not available yet.`);
          return;
        }

        const key = sessionKey(account);
        websocketSessions.get(key)?.stop();
        const session = new ClawChannelWebSocketSession({
          api,
          account,
          getStatus,
          setStatus,
          log,
        });
        websocketSessions.set(key, session);
        session.start();
        return;
      }

      if (account.mode === "webhook" && account.pairOnStart && isClawChannelConfigured(account)) {
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
      account,
      getStatus,
      setStatus,
    }: {
      account?: ClawChannelAccount;
      getStatus: () => Record<string, unknown>;
      setStatus: (status: Record<string, unknown>) => void;
    }) => {
      if (account) {
        const key = sessionKey(account);
        websocketSessions.get(key)?.stop();
        websocketSessions.delete(key);
      }

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
        socketUrl: account.socketUrl,
        machineId: account.machineId,
        mode: account.mode,
        backend: probe?.ok ? "reachable" : probe?.message ?? "not probed",
      },
    }),
  },
} as unknown as ChannelPlugin<ClawChannelAccount>;

export function registerRuntimeApi(api: RuntimeApi) {
  runtimeApi = api;
  const account = resolveClawChannelAccount(api.config, undefined);
  if (account.mode === "webhook") {
    registerInboundRoute(api);
  } else {
    api.logger.info(`${CHANNEL_ID}: using outbound WebSocket mode`);
  }
}

function resolveRuntimeApi(ctx: GatewayStartContext): RuntimeApi | undefined {
  if (runtimeApi) return runtimeApi;
  const cfg = ctx.cfg ?? ctx.config;
  if (!cfg || !ctx.runtime) return undefined;
  return {
    config: cfg,
    runtime: ctx.runtime,
    logger: {
      debug: ctx.log?.debug,
      info: ctx.log?.info ?? (() => undefined),
      warn: ctx.log?.warn,
      error: ctx.log?.error ?? (() => undefined),
    },
    registerHttpRoute: () => undefined,
  };
}

function sessionKey(account: ClawChannelAccount): string {
  return `${account.accountId}:${account.machineId ?? "unknown"}`;
}

function extractPayloadText(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const maybeText = (payload as Record<string, unknown>).text;
    if (typeof maybeText === "string") return maybeText;
  }

  return "";
}
