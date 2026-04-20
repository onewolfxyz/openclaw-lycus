import type {
  ClawChannelAccount,
  ClawChannelAckStatus,
  ClawChannelOutboundIndicator,
  ClawChannelOutboundMessage,
  ClawChannelPairResponse,
  ClawChannelPullResponse,
} from "./types.js";

type RequestOptions = {
  method?: string;
  path: string;
  body?: unknown;
  timeoutMs?: number;
};

export async function pairMachine(
  account: ClawChannelAccount,
): Promise<ClawChannelPairResponse> {
  ensureConfigured(account);

  const response = await backendRequest<ClawChannelPairResponse>(account, {
    method: "POST",
    path: account.api.pairPath,
    body: {
      channelId: "claw-channel",
      accountId: account.accountId,
      machineId: account.machineId,
      machineName: account.machineName,
      capabilities: {
        chatTypes: ["direct", "group"],
        markdown: true,
        blockStreaming: account.blockStreaming,
      },
    },
  });

  return {
    ok: response.ok ?? true,
    paired: response.paired ?? true,
    accountId: response.accountId ?? account.accountId,
    machineId: response.machineId ?? account.machineId!,
    socketUrl: response.socketUrl ?? account.socketUrl,
    message: response.message,
  };
}

export async function sendBackendMessage(
  account: ClawChannelAccount,
  message: ClawChannelOutboundMessage,
): Promise<{ messageId?: string }> {
  ensureConfigured(account);
  return backendRequest<{ messageId?: string }>(account, {
    method: "POST",
    path: account.api.messagesPath,
    body: message,
  });
}

export async function sendBackendIndicator(
  account: ClawChannelAccount,
  indicator: ClawChannelOutboundIndicator,
): Promise<void> {
  ensureConfigured(account);
  await backendRequest(account, {
    method: "POST",
    path: account.api.indicatorsPath,
    body: indicator,
  });
}

export async function ackBackendEvent(
  account: ClawChannelAccount,
  eventId: string,
  status: ClawChannelAckStatus = "processed",
): Promise<void> {
  ensureConfigured(account);
  await backendRequest(account, {
    method: "POST",
    path: account.api.ackPath,
    body: {
      eventId,
      status,
    },
  });
}

export async function pullBackendEvents(
  account: ClawChannelAccount,
  afterCursor?: string | null,
  limit = 50,
): Promise<ClawChannelPullResponse> {
  ensureConfigured(account);
  const response = await backendRequest<ClawChannelPullResponse>(account, {
    method: "POST",
    path: account.api.pullPath,
    body: {
      afterCursor: afterCursor ?? null,
      limit,
    },
  });

  return {
    ok: response.ok ?? true,
    cursor: response.cursor ?? null,
    events: response.events ?? [],
  };
}

export async function probeBackend(account: ClawChannelAccount): Promise<{
  ok: boolean;
  status: number;
  message?: string;
}> {
  ensureConfigured(account);

  try {
    await backendRequest(account, {
      method: "GET",
      path: account.api.healthPath,
      timeoutMs: 5_000,
    });
    return { ok: true, status: 200 };
  } catch (error) {
    return {
      ok: false,
      status:
        error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : 0,
      message: error instanceof Error ? error.message : "Unknown backend error",
    };
  }
}

async function backendRequest<T = unknown>(
  account: ClawChannelAccount,
  options: RequestOptions,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const response = await fetch(`${account.baseUrl}${options.path}`, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${account.machineToken}`,
        "content-type": "application/json",
        "x-openclaw-channel": "claw-channel",
        "x-openclaw-account-id": account.accountId,
        ...(account.machineId
          ? { "x-openclaw-machine-id": account.machineId }
          : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(stripUndefined(options.body)),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = text ? safeJson(text) : undefined;

    if (!response.ok) {
      throw Object.assign(
        new Error(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : `Backend request failed with ${response.status}`,
        ),
        { status: response.status },
      );
    }

    return (payload ?? {}) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function ensureConfigured(account: ClawChannelAccount) {
  if (!account.baseUrl) {
    throw new Error("claw-channel: backend baseUrl is required");
  }

  if (!account.machineToken) {
    throw new Error("claw-channel: machineToken is required");
  }

  if (!account.machineId) {
    throw new Error("claw-channel: machineId is required");
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
    );
  }

  return value;
}
