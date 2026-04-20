import WebSocket from "ws";

import {
  ackBackendEvent,
  pairMachine,
  pullBackendEvents,
} from "./client.js";
import { CHANNEL_ID, CHANNEL_LABEL } from "./constants.js";
import {
  dispatchInboundEvent,
  type RuntimeApi,
} from "./inbound.js";
import type {
  ClawChannelAccount,
  ClawChannelBackendMessage,
  ClawChannelPairResponse,
} from "./types.js";

type RuntimeStatus = Record<string, unknown>;

type WebSocketSessionOptions = {
  api: RuntimeApi;
  account: ClawChannelAccount;
  getStatus: () => RuntimeStatus;
  setStatus: (status: RuntimeStatus) => void;
  log?: {
    debug?: (message: string) => void;
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
};

const ACTION_CABLE_IDENTIFIER = JSON.stringify({
  channel: "OpenclawMachineChannel",
});

export class ClawChannelWebSocketSession {
  private ws?: WebSocket;
  private stopped = false;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private pullCursor: string | null = null;
  private processing: Promise<void> = Promise.resolve();
  private inFlightEventIds = new Set<string>();
  private processedEventIds = new Set<string>();
  private socketUrl?: string;

  constructor(private readonly options: WebSocketSessionOptions) {}

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.ws?.close();
    this.ws = undefined;
    this.setRuntimeStatus({ running: false, connected: false });
  }

  private async connect() {
    if (this.stopped) return;

    const { account, log } = this.options;

    try {
      const paired = account.pairOnStart
        ? await pairMachine(account)
        : ({ socketUrl: account.socketUrl, machineId: account.machineId } as ClawChannelPairResponse);

      this.socketUrl = paired.socketUrl ?? account.socketUrl;
      log?.info?.(
        `${CHANNEL_LABEL}: paired machine account=${paired.accountId} machine=${paired.machineId}`,
      );

      if (!this.socketUrl) {
        throw new Error("pair response did not include socketUrl");
      }

      const url = buildCableUrl(this.socketUrl, paired.machineId ?? account.machineId);
      log?.info?.(`${CHANNEL_LABEL}: connecting WebSocket ${url.origin}${url.pathname}`);

      const ws = new WebSocket(url, "actioncable-v1-json", {
        headers: {
          authorization: `Bearer ${account.machineToken}`,
          origin: account.baseUrl ?? url.origin,
          "x-openclaw-channel": CHANNEL_ID,
          "x-openclaw-account-id": account.accountId,
          "x-openclaw-machine-id": paired.machineId ?? account.machineId ?? "",
        },
      });

      this.ws = ws;

      ws.on("open", () => {
        this.reconnectAttempt = 0;
        log?.info?.(
          `${CHANNEL_LABEL}: WebSocket opened machine=${paired.machineId ?? account.machineId}`,
        );
        this.setRuntimeStatus({
          running: true,
          connected: false,
          socket: "open",
        });
      });

      ws.on("message", (data) => {
        this.handleSocketMessage(data.toString()).catch((error) => {
          log?.error?.(
            `${CHANNEL_LABEL}: WebSocket message failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        });
      });

      ws.on("close", (code, reason) => {
        this.setRuntimeStatus({
          running: true,
          connected: false,
          socket: "closed",
          closeCode: code,
        });
        log?.warn?.(
          `${CHANNEL_LABEL}: WebSocket closed (${code}) ${
            reason.length ? reason.toString() : ""
          }`.trim(),
        );
        this.scheduleReconnect();
      });

      ws.on("error", (error) => {
        this.setRuntimeStatus({
          running: true,
          connected: false,
          socket: "error",
          error: error.message,
        });
        log?.warn?.(`${CHANNEL_LABEL}: WebSocket error: ${error.message}`);
      });
    } catch (error) {
      this.setRuntimeStatus({
        running: true,
        connected: false,
        socket: "connect_failed",
        error: error instanceof Error ? error.message : "unknown error",
      });
      log?.warn?.(
        `${CHANNEL_LABEL}: WebSocket connect failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      this.scheduleReconnect();
    }
  }

  private async handleSocketMessage(raw: string) {
    const frame = safeJson(raw);
    if (!frame || typeof frame !== "object") return;

    const type = readString(frame, "type");
    if (type === "welcome") {
      this.options.log?.info?.(`${CHANNEL_LABEL}: Action Cable welcome received`);
      return this.subscribe();
    }
    if (type === "confirm_subscription") {
      this.options.log?.info?.(
        `${CHANNEL_LABEL}: Action Cable subscription confirmed channel=OpenclawMachineChannel`,
      );
      this.setRuntimeStatus({
        running: true,
        connected: true,
        socket: "subscribed",
      });
      await this.pullReplayEvents();
      return;
    }
    if (type === "ping") {
      this.options.log?.debug?.(`${CHANNEL_LABEL}: Action Cable ping received`);
      return this.sendCableAction("ping", {});
    }
    if (type === "reject_subscription") {
      throw new Error("Action Cable subscription was rejected");
    }

    const payload = readMessagePayload(frame);
    if (payload.message) {
      this.options.log?.info?.(
        `${CHANNEL_LABEL}: received event eventId=${payload.message.eventId ?? "missing"} messageId=${
          payload.message.messageId ?? payload.message.id ?? "missing"
        } conversation=${payload.message.conversationId ?? "missing"} text="${previewText(
          payload.message.text ?? payload.message.body,
        )}"`,
      );
      this.enqueueEvent(payload.message);
      return;
    }

    if (payload.reason) {
      this.options.log?.debug?.(
        `${CHANNEL_LABEL}: ignored Action Cable payload reason=${payload.reason}`,
      );
      return;
    }

    this.options.log?.debug?.(`${CHANNEL_LABEL}: ignored non-message Action Cable frame`);
  }

  private subscribe() {
    this.options.log?.info?.(
      `${CHANNEL_LABEL}: subscribing to Action Cable channel=OpenclawMachineChannel`,
    );
    this.send({
      command: "subscribe",
      identifier: ACTION_CABLE_IDENTIFIER,
    });
  }

  private async pullReplayEvents() {
    this.options.log?.info?.(
      `${CHANNEL_LABEL}: pulling replay events afterCursor=${this.pullCursor ?? "null"}`,
    );
    const response = await pullBackendEvents(this.options.account, this.pullCursor, 50);
    this.options.log?.info?.(
      `${CHANNEL_LABEL}: replay pull returned count=${response.events.length} cursor=${
        response.cursor ?? "null"
      }`,
    );
    for (const event of response.events) {
      this.enqueueEvent(event);
    }
    this.pullCursor = response.cursor ?? this.pullCursor;
  }

  private enqueueEvent(event: ClawChannelBackendMessage) {
    const eventId = event.eventId;
    if (eventId && (this.inFlightEventIds.has(eventId) || this.processedEventIds.has(eventId))) {
      this.options.log?.info?.(`${CHANNEL_LABEL}: skipped duplicate event eventId=${eventId}`);
      return;
    }

    if (eventId) this.inFlightEventIds.add(eventId);
    this.options.log?.info?.(
      `${CHANNEL_LABEL}: queued event eventId=${eventId ?? "missing"} messageId=${
        event.messageId ?? event.id ?? "missing"
      }`,
    );

    this.processing = this.processing
      .then(() => this.processEvent(event))
      .finally(() => {
        if (eventId) this.inFlightEventIds.delete(eventId);
      });
  }

  private async processEvent(event: ClawChannelBackendMessage) {
    const eventId = event.eventId;

    this.options.log?.info?.(
      `${CHANNEL_LABEL}: dispatching event to OpenClaw eventId=${eventId ?? "missing"} messageId=${
        event.messageId ?? event.id ?? "missing"
      } conversation=${event.conversationId ?? "missing"}`,
    );
    await dispatchInboundEvent(this.options.api, this.options.account, event);
    this.options.log?.info?.(
      `${CHANNEL_LABEL}: OpenClaw dispatch finished eventId=${eventId ?? "missing"}`,
    );

    if (eventId) {
      await ackBackendEvent(this.options.account, eventId, "processed");
      this.options.log?.info?.(`${CHANNEL_LABEL}: acked event eventId=${eventId} status=processed`);
      this.processedEventIds.add(eventId);
      this.pullCursor = eventId;
      trimSet(this.processedEventIds, 500);
    }
  }

  private sendCableAction(action: string, payload: Record<string, unknown>) {
    this.send({
      command: "message",
      identifier: ACTION_CABLE_IDENTIFIER,
      data: JSON.stringify({ action, ...payload }),
    });
  }

  private send(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delayMs = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.options.log?.info?.(
      `${CHANNEL_LABEL}: scheduling WebSocket reconnect delayMs=${delayMs}`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delayMs);
  }

  private setRuntimeStatus(status: RuntimeStatus) {
    this.options.setStatus({
      ...this.options.getStatus(),
      ...status,
      configured: true,
      accountId: this.options.account.accountId,
      machineId: this.options.account.machineId,
      mode: "websocket",
    });
  }
}

function buildCableUrl(socketUrl: string, machineId?: string): URL {
  if (!machineId) throw new Error("machineId is required for WebSocket connection");

  const url = new URL(socketUrl);
  url.searchParams.set("machine_id", machineId);
  return url;
}

function readMessagePayload(frame: Record<string, unknown>): {
  message: ClawChannelBackendMessage | null;
  reason?: string;
} {
  const wrapped = frame.message;
  if (wrapped && typeof wrapped === "object") {
    return validateMessagePayload(wrapped as Record<string, unknown>);
  }

  if (frame.type === "message" && typeof frame.eventId === "string") {
    return validateMessagePayload(frame);
  }

  return { message: null };
}

function validateMessagePayload(payload: Record<string, unknown>): {
  message: ClawChannelBackendMessage | null;
  reason?: string;
} {
  if (payload.type !== "message") {
    return { message: null, reason: `type_${String(payload.type ?? "missing")}` };
  }

  for (const key of ["eventId", "messageId", "conversationId", "text"]) {
    if (typeof payload[key] !== "string" || payload[key].trim() === "") {
      return { message: null, reason: `missing_${key}` };
    }
  }

  return { message: payload as ClawChannelBackendMessage };
}

function readString(frame: Record<string, unknown>, key: string): string | undefined {
  const value = frame[key];
  return typeof value === "string" ? value : undefined;
}

function safeJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function trimSet<T>(set: Set<T>, maxSize: number) {
  while (set.size > maxSize) {
    const first = set.values().next().value;
    if (first === undefined) return;
    set.delete(first);
  }
}

function previewText(text: string | undefined): string {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}
