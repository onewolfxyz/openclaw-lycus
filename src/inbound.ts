import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";

import { sendBackendIndicator, sendBackendMessage } from "./client.js";
import { CHANNEL_ID } from "./constants.js";
import { resolveClawChannelAccount } from "./config.js";
import {
  errorMessage,
  errorStatus,
  parseJsonBody,
  readRequestBody,
  verifyBearerToken,
  verifyHmacSignature,
  writeJson,
} from "./http.js";
import type {
  ClawChannelAccount,
  ClawChannelBackendIndicator,
  ClawChannelBackendMessage,
  ClawChannelInboundEvent,
} from "./types.js";

export type OpenClawPluginApi = {
  config: Record<string, unknown>;
  logger: {
    debug?: (message: string) => void;
    info: (message: string) => void;
    warn?: (message: string) => void;
    error: (message: string) => void;
  };
  registerHttpRoute: (route: {
    path: string;
    auth: "plugin";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  }) => void;
};

type RuntimeReply = {
  finalizeInboundContext?: (ctx: Record<string, unknown>) => unknown;
  dispatchReplyWithBufferedBlockDispatcher?: (params: Record<string, unknown>) => Promise<void>;
};

export type RuntimeApi = OpenClawPluginApi & {
  runtime?: {
    channel?: {
      reply?: RuntimeReply;
    };
  };
};

export function registerInboundRoute(api: OpenClawPluginApi) {
  const account = resolveClawChannelAccount(api.config, undefined);

  api.registerHttpRoute({
    path: account.inboundPath,
    auth: "plugin",
    handler: async (req, res) => {
      await handleInboundHttp(api as RuntimeApi, req, res);
      return true;
    },
  });

  api.logger.info(`${CHANNEL_ID}: inbound route registered at ${account.inboundPath}`);
}

async function handleInboundHttp(
  api: RuntimeApi,
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    const body = await readRequestBody(req);
    const accountId = readAccountIdFromRequest(req, body);
    const account = resolveClawChannelAccount(api.config, accountId);

    if (!isAuthorizedInbound(req, body, account)) {
      writeJson(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }

    const event = parseJsonBody<ClawChannelInboundEvent>(body);
    writeJson(res, 202, { ok: true });

    void dispatchInboundEvent(api, account, event).catch((error) => {
      api.logger.error(`${CHANNEL_ID}: inbound dispatch failed: ${errorMessage(error)}`);
    });
  } catch (error) {
    writeJson(res, errorStatus(error), {
      ok: false,
      error: errorMessage(error),
    });
  }
}

export async function dispatchInboundEvent(
  api: RuntimeApi,
  defaultAccount: ClawChannelAccount,
  event: ClawChannelInboundEvent,
) {
  if ("type" in event && event.type === "batch") {
    for (const child of event.events) {
      const childAccount = resolveClawChannelAccount(
        api.config,
        child.accountId ?? event.accountId ?? defaultAccount.accountId,
      );
      await dispatchInboundEvent(api, childAccount, child);
    }
    return;
  }

  if (isIndicatorEvent(event)) {
    api.logger.debug?.(`${CHANNEL_ID}: indicator received (${event.type})`);
    return;
  }

  await dispatchMessage(api, defaultAccount, normalizeMessage(event));
}

async function dispatchMessage(
  api: RuntimeApi,
  account: ClawChannelAccount,
  message: RequiredNormalizedMessage,
) {
  const replyRuntime = api.runtime?.channel?.reply;
  if (!replyRuntime?.dispatchReplyWithBufferedBlockDispatcher) {
    throw new Error("OpenClaw channel reply runtime is not available.");
  }

  const rawContext = {
    Body: message.text,
    RawBody: message.text,
    CommandBody: message.text,
    CommandAuthorized: true,
    From: message.from,
    To: message.conversationId,
    SessionKey:
      message.sessionKey ??
      buildSessionKey(account.accountId, message.chatType, message.conversationId, message.threadId),
    AccountId: account.accountId,
    ChatType: message.chatType,
    ConversationLabel:
      message.conversationLabel ??
      `${message.chatType}:${message.conversationId}`,
    SenderName: message.senderName ?? message.from,
    SenderId: message.senderId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    ThreadId: message.threadId,
    ReplyToId: message.replyToId,
    ChannelData: message.channelData,
  };

  const ctx =
    replyRuntime.finalizeInboundContext?.(rawContext) ?? rawContext;

  await replyRuntime.dispatchReplyWithBufferedBlockDispatcher({
    ctx,
    cfg: api.config,
    dispatcherOptions: {
      deliver: async (payload: unknown, info: { kind?: string } = {}) => {
        const text = extractReplyText(payload);
        if (!text) return;

        await sendBackendMessage(account, {
          accountId: account.accountId,
          machineId: account.machineId,
          conversationId: message.conversationId,
          text,
          threadId: message.threadId,
          replyToId: message.messageId,
          replyId: buildReplyId(account.machineId, message, text, info.kind),
          kind: info.kind,
          payload,
        });
      },
      onError: async (error: unknown) => {
        await sendBackendIndicator(account, {
          accountId: account.accountId,
          machineId: account.machineId,
          conversationId: message.conversationId,
          type: "error",
          text: errorMessage(error),
          threadId: message.threadId,
        });
      },
      typingCallbacks: {
        pulse: async () => {
          await sendBackendIndicator(account, {
            accountId: account.accountId,
            machineId: account.machineId,
            conversationId: message.conversationId,
            type: "typing",
            threadId: message.threadId,
          });
        },
        stop: async () => {
          await sendBackendIndicator(account, {
            accountId: account.accountId,
            machineId: account.machineId,
            conversationId: message.conversationId,
            type: "typing_stopped",
            threadId: message.threadId,
          });
        },
      },
    },
    replyOptions: {
      disableBlockStreaming: !account.blockStreaming,
    },
  });
}

type RequiredNormalizedMessage = {
  eventId?: string;
  messageId: string;
  conversationId: string;
  from: string;
  senderId: string;
  senderName?: string;
  text: string;
  chatType: "direct" | "group";
  threadId?: string | number | null;
  replyToId?: string | null;
  timestamp: number;
  sessionKey?: string;
  conversationLabel?: string;
  channelData?: Record<string, unknown>;
};

function normalizeMessage(message: ClawChannelBackendMessage): RequiredNormalizedMessage {
  const text = message.text ?? message.body;
  if (!text) throw Object.assign(new Error("Message text is required"), { statusCode: 400 });

  const conversationId = message.conversationId ?? message.to ?? message.from;
  if (!conversationId) {
    throw Object.assign(new Error("conversationId is required"), { statusCode: 400 });
  }

  const senderId = message.senderId ?? message.from;
  if (!senderId) {
    throw Object.assign(new Error("senderId is required"), { statusCode: 400 });
  }

  return {
    eventId: message.eventId,
    messageId: message.messageId ?? message.id ?? `${Date.now()}:${senderId}`,
    conversationId,
    from: message.from ?? senderId,
    senderId,
    senderName: message.senderName,
    text,
    chatType: message.chatType ?? "direct",
    threadId: message.threadId,
    replyToId: message.replyToId,
    timestamp: normalizeTimestamp(message.timestamp),
    sessionKey: message.sessionKey,
    conversationLabel: message.conversationLabel,
    channelData: message.channelData,
  };
}

function buildReplyId(
  machineId: string | undefined,
  message: RequiredNormalizedMessage,
  text: string,
  kind?: string,
): string {
  const stable = [
    machineId ?? "",
    message.conversationId,
    message.messageId,
    kind ?? "final",
    text,
  ].join("|");

  return `rep_${createHash("sha256").update(stable).digest("hex").slice(0, 32)}`;
}

function isIndicatorEvent(
  event: ClawChannelInboundEvent,
): event is ClawChannelBackendIndicator {
  return (
    "type" in event &&
    event.type !== undefined &&
    event.type !== "message" &&
    event.type !== "batch"
  );
}

function isAuthorizedInbound(
  req: IncomingMessage,
  body: Buffer,
  account: ClawChannelAccount,
): boolean {
  return (
    verifyHmacSignature(req, body, account.webhookSecret) ||
    verifyBearerToken(req, account.machineToken)
  );
}

function readAccountIdFromRequest(
  req: IncomingMessage,
  body: Buffer,
): string | undefined {
  const header = req.headers["x-openclaw-account-id"];
  if (typeof header === "string" && header.trim()) return header.trim();

  try {
    const parsed = JSON.parse(body.toString("utf8")) as { accountId?: string };
    return parsed.accountId;
  } catch {
    return undefined;
  }
}

function buildSessionKey(
  accountId: string,
  chatType: string,
  conversationId: string,
  threadId?: string | number | null,
): string {
  const base = `${CHANNEL_ID}:${accountId}:${chatType}:${conversationId}`;
  return threadId === undefined || threadId === null ? base : `${base}:thread:${threadId}`;
}

function normalizeTimestamp(value: number | string | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function extractReplyText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const text = (payload as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }
  return "";
}
