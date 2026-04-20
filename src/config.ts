import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";

import {
  CHANNEL_ID,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_HEALTH_PATH,
  DEFAULT_INBOUND_PATH,
  DEFAULT_INDICATORS_PATH,
  DEFAULT_MESSAGES_PATH,
  DEFAULT_PAIR_PATH,
  ENV_BASE_URL,
  ENV_MACHINE_ID,
  ENV_MACHINE_TOKEN,
  ENV_WEBHOOK_SECRET,
} from "./constants.js";
import type {
  ClawChannelAccount,
  ClawChannelAccountConfig,
  ClawChannelConfigSection,
  ClawChannelDmPolicy,
} from "./types.js";

type ConfigWithChannels = OpenClawConfig & {
  channels?: Record<string, unknown>;
};

const ACCOUNT_FIELDS = new Set(["accounts"]);

export const clawChannelConfigSchema = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      baseUrl: { type: "string" },
      machineToken: { type: "string" },
      machineId: { type: "string" },
      machineName: { type: "string" },
      gatewayPublicUrl: { type: "string" },
      inboundPath: { type: "string" },
      webhookSecret: { type: "string" },
      defaultTo: { type: "string" },
      dmPolicy: {
        type: "string",
        enum: ["pairing", "allowlist", "open", "disabled"],
      },
      allowFrom: {
        type: "array",
        items: { type: "string" },
      },
      pairOnStart: { type: "boolean" },
      blockStreaming: { type: "boolean" },
      api: {
        type: "object",
        additionalProperties: false,
        properties: {
          pairPath: { type: "string" },
          messagesPath: { type: "string" },
          indicatorsPath: { type: "string" },
          healthPath: { type: "string" },
        },
      },
      accounts: {
        type: "object",
        additionalProperties: {
          type: "object",
        },
      },
    },
  },
  uiHints: {
    baseUrl: {
      label: "Backend URL",
      placeholder: "https://app.example.com",
    },
    machineToken: {
      label: "Machine token",
      sensitive: true,
    },
    webhookSecret: {
      label: "Webhook secret",
      sensitive: true,
    },
  },
};

export function listClawChannelAccountIds(cfg: OpenClawConfig): string[] {
  const section = getSection(cfg);
  const accountIds = Object.keys(section.accounts ?? {});
  return accountIds.length > 0 ? accountIds : [DEFAULT_ACCOUNT_ID];
}

export function resolveClawChannelAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ClawChannelAccount {
  const section = getSection(cfg);
  const resolvedAccountId = resolveAccountId(section, accountId);
  const rawAccount = section.accounts?.[resolvedAccountId] ?? {};
  const topLevel = withoutAccountFields(section);
  const merged = { ...topLevel, ...rawAccount };

  const env = process.env;
  const baseUrl = normalizeBaseUrl(merged.baseUrl ?? env[ENV_BASE_URL]);
  const machineToken = merged.machineToken ?? env[ENV_MACHINE_TOKEN];
  const machineId = merged.machineId ?? env[ENV_MACHINE_ID];
  const webhookSecret = merged.webhookSecret ?? env[ENV_WEBHOOK_SECRET];

  return {
    accountId: resolvedAccountId,
    enabled: merged.enabled ?? true,
    baseUrl,
    machineToken,
    machineId,
    machineName: merged.machineName,
    gatewayPublicUrl: normalizeBaseUrl(merged.gatewayPublicUrl),
    inboundPath: normalizePath(merged.inboundPath, DEFAULT_INBOUND_PATH),
    webhookSecret,
    defaultTo: merged.defaultTo,
    dmPolicy: normalizeDmPolicy(merged.dmPolicy),
    allowFrom: normalizeStringArray(merged.allowFrom),
    pairOnStart: merged.pairOnStart ?? true,
    blockStreaming: merged.blockStreaming ?? true,
    api: {
      pairPath: normalizePath(merged.api?.pairPath, DEFAULT_PAIR_PATH),
      messagesPath: normalizePath(merged.api?.messagesPath, DEFAULT_MESSAGES_PATH),
      indicatorsPath: normalizePath(
        merged.api?.indicatorsPath,
        DEFAULT_INDICATORS_PATH,
      ),
      healthPath: normalizePath(merged.api?.healthPath, DEFAULT_HEALTH_PATH),
    },
  };
}

export function inspectClawChannelAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
) {
  const account = resolveClawChannelAccount(cfg, accountId);

  return {
    enabled: account.enabled,
    configured: isClawChannelConfigured(account),
    accountId: account.accountId,
    baseUrl: account.baseUrl ? "configured" : "missing",
    machineTokenStatus: account.machineToken ? "available" : "missing",
    webhookSecretStatus: account.webhookSecret ? "available" : "missing",
  };
}

export function isClawChannelConfigured(account: ClawChannelAccount): boolean {
  return Boolean(account.baseUrl && account.machineToken);
}

export function upsertAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
  input: Record<string, unknown>,
): OpenClawConfig {
  const next = structuredClone(cfg) as ConfigWithChannels;
  next.channels ??= {};
  const section = ((next.channels[CHANNEL_ID] ??= {}) as ClawChannelConfigSection);
  const target =
    accountId === DEFAULT_ACCOUNT_ID
      ? section
      : ((section.accounts ??= {})[accountId] ??= {});

  assignString(input, target, "baseUrl");
  assignString(input, target, "machineToken");
  assignString(input, target, "machineId");
  assignString(input, target, "machineName");
  assignString(input, target, "gatewayPublicUrl");
  assignString(input, target, "inboundPath");
  assignString(input, target, "webhookSecret");
  assignString(input, target, "defaultTo");
  assignString(input, target, "dmPolicy");
  assignStringArray(input, target, "allowFrom");
  assignBoolean(input, target, "enabled");
  assignBoolean(input, target, "pairOnStart");
  assignBoolean(input, target, "blockStreaming");

  target.enabled ??= true;
  target.dmPolicy ??= "pairing";
  return next as OpenClawConfig;
}

export function validateAccountInput(input: Record<string, unknown>): string | null {
  const baseUrl = readSetupString(input, "baseUrl");
  const machineToken = readSetupString(input, "machineToken");

  if (!baseUrl && !process.env[ENV_BASE_URL]) {
    return "Claw Channel backend URL is required.";
  }

  if (!machineToken && !process.env[ENV_MACHINE_TOKEN]) {
    return "Claw Channel machine token is required.";
  }

  return null;
}

export function readSetupString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const direct = input[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const values = input.values;
  if (values && typeof values === "object") {
    const nested = (values as Record<string, unknown>)[key];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }

  return undefined;
}

function getSection(cfg: OpenClawConfig): ClawChannelConfigSection {
  const channels = (cfg as ConfigWithChannels).channels ?? {};
  const raw = channels[CHANNEL_ID];
  return raw && typeof raw === "object" ? (raw as ClawChannelConfigSection) : {};
}

function resolveAccountId(
  section: ClawChannelConfigSection,
  accountId?: string | null,
): string {
  if (accountId) return accountId;
  if (section.accounts?.[DEFAULT_ACCOUNT_ID]) return DEFAULT_ACCOUNT_ID;
  return Object.keys(section.accounts ?? {})[0] ?? DEFAULT_ACCOUNT_ID;
}

function withoutAccountFields(
  section: ClawChannelConfigSection,
): ClawChannelAccountConfig {
  return Object.fromEntries(
    Object.entries(section).filter(([key]) => !ACCOUNT_FIELDS.has(key)),
  ) as ClawChannelAccountConfig;
}

function normalizeBaseUrl(value?: string): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/\/+$/, "");
}

function normalizePath(value: string | undefined, fallback: string): string {
  const path = value?.trim() || fallback;
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeDmPolicy(value?: string): ClawChannelDmPolicy {
  if (
    value === "pairing" ||
    value === "allowlist" ||
    value === "open" ||
    value === "disabled"
  ) {
    return value;
  }

  return "pairing";
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function assignString(
  input: Record<string, unknown>,
  target: ClawChannelAccountConfig,
  key: keyof ClawChannelAccountConfig,
) {
  const value = readSetupString(input, key);
  if (value) {
    (target as Record<string, unknown>)[key] = value;
  }
}

function assignStringArray(
  input: Record<string, unknown>,
  target: ClawChannelAccountConfig,
  key: keyof ClawChannelAccountConfig,
) {
  const value = input[key] ?? (input.values as Record<string, unknown> | undefined)?.[key];
  const normalized = normalizeStringArray(value);
  if (normalized.length > 0) {
    (target as Record<string, unknown>)[key] = normalized;
  }
}

function assignBoolean(
  input: Record<string, unknown>,
  target: ClawChannelAccountConfig,
  key: keyof ClawChannelAccountConfig,
) {
  const value = input[key] ?? (input.values as Record<string, unknown> | undefined)?.[key];
  if (typeof value === "boolean") {
    (target as Record<string, unknown>)[key] = value;
  }
}
