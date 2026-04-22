import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import { pairMachine } from "./client.js";
import {
  CHANNEL_ID,
  CHANNEL_LABEL,
  DEFAULT_ACCOUNT_ID,
  ENV_MACHINE_ID,
  ENV_MACHINE_TOKEN,
  LEGACY_ENV_MACHINE_ID,
  LEGACY_ENV_MACHINE_TOKEN,
} from "./constants.js";
import {
  isClawChannelConfigured,
  resolveClawChannelAccount,
  upsertAccountConfig,
} from "./config.js";

type WizardNote = {
  note?: (text: string) => void;
};

type CredentialKey = "machineToken" | "machineId";

function inspectCredential(
  cfg: OpenClawConfig,
  accountId: string,
  key: CredentialKey,
  primaryEnv: string,
  legacyEnv: string,
) {
  const account = resolveClawChannelAccount(cfg, accountId);
  const configuredValue = account[key];
  const envValue = process.env[primaryEnv] ?? process.env[legacyEnv];
  return {
    accountConfigured: Boolean(configuredValue),
    hasConfiguredValue: Boolean(configuredValue),
    resolvedValue: configuredValue ?? envValue,
    envValue,
  };
}

export const clawChannelSetupWizard = {
  channel: CHANNEL_ID,
  status: {
    configuredLabel: `${CHANNEL_LABEL} ready`,
    unconfiguredLabel: `${CHANNEL_LABEL} needs a machine token and id`,
    resolveConfigured: ({
      cfg,
      accountId,
    }: {
      cfg: OpenClawConfig;
      accountId?: string;
    }) => isClawChannelConfigured(resolveClawChannelAccount(cfg, accountId)),
    resolveStatusLines: ({
      cfg,
      accountId,
      configured,
    }: {
      cfg: OpenClawConfig;
      accountId?: string;
      configured: boolean;
    }) => {
      if (configured) {
        const account = resolveClawChannelAccount(cfg, accountId);
        return [
          `Backend: ${account.baseUrl}`,
          `Machine: ${account.machineId}`,
        ];
      }
      return [
        "Create a machine at https://app.lycus.ai to get a token and machine id.",
      ];
    },
  },
  introNote: {
    title: `Connect this device to ${CHANNEL_LABEL}`,
    lines: [
      "1. Sign in at https://app.lycus.ai and add a new machine.",
      "2. Copy the machine token and machine id shown there.",
      "3. Paste them into the prompts below.",
    ],
  },
  credentials: [
    {
      inputKey: "machineToken" as const,
      providerHint: CHANNEL_ID,
      credentialLabel: `${CHANNEL_LABEL} machine token`,
      preferredEnvVar: ENV_MACHINE_TOKEN,
      helpTitle: `${CHANNEL_LABEL} machine token`,
      helpLines: [
        "Authenticates this OpenClaw device with your Lycus workspace.",
        "Copy it from the machine's settings page on https://app.lycus.ai.",
      ],
      envPrompt: `Use ${ENV_MACHINE_TOKEN} from the environment?`,
      keepPrompt: "Keep the existing Lycus machine token?",
      inputPrompt: "Paste your Lycus machine token:",
      inspect: ({
        cfg,
        accountId,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
      }) =>
        inspectCredential(
          cfg,
          accountId,
          "machineToken",
          ENV_MACHINE_TOKEN,
          LEGACY_ENV_MACHINE_TOKEN,
        ),
      applySet: ({
        cfg,
        accountId,
        resolvedValue,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
        resolvedValue: string;
      }) => upsertAccountConfig(cfg, accountId, { machineToken: resolvedValue }),
    },
    {
      inputKey: "machineId" as const,
      providerHint: CHANNEL_ID,
      credentialLabel: `${CHANNEL_LABEL} machine id`,
      preferredEnvVar: ENV_MACHINE_ID,
      helpTitle: `${CHANNEL_LABEL} machine id`,
      helpLines: [
        "Identifies this device in your Lycus workspace.",
        "Copy it from the same machine settings page as the token.",
      ],
      envPrompt: `Use ${ENV_MACHINE_ID} from the environment?`,
      keepPrompt: "Keep the existing Lycus machine id?",
      inputPrompt: "Paste your Lycus machine id:",
      inspect: ({
        cfg,
        accountId,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
      }) =>
        inspectCredential(
          cfg,
          accountId,
          "machineId",
          ENV_MACHINE_ID,
          LEGACY_ENV_MACHINE_ID,
        ),
      applySet: ({
        cfg,
        accountId,
        resolvedValue,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
        resolvedValue: string;
      }) => upsertAccountConfig(cfg, accountId, { machineId: resolvedValue }),
    },
  ],
  textInputs: [
    {
      inputKey: "machineName" as const,
      message: "Machine name shown in Lycus (optional):",
      placeholder: "e.g. Work Macbook",
      required: false,
      applyEmptyValue: false,
      currentValue: ({
        cfg,
        accountId,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
      }) => resolveClawChannelAccount(cfg, accountId).machineName,
      applySet: ({
        cfg,
        accountId,
        value,
      }: {
        cfg: OpenClawConfig;
        accountId: string;
        value: string;
      }) => upsertAccountConfig(cfg, accountId, { machineName: value }),
    },
  ],
  finalize: async ({
    cfg,
    accountId,
    prompter,
  }: {
    cfg: OpenClawConfig;
    accountId: string;
    prompter?: WizardNote;
  }) => {
    const account = resolveClawChannelAccount(cfg, accountId);
    if (!isClawChannelConfigured(account)) return;

    try {
      const paired = await pairMachine(account);
      prompter?.note?.(
        `${CHANNEL_LABEL}: paired ${paired.machineId} with ${account.baseUrl}.`,
      );

      if (paired.machineId && paired.machineId !== account.machineId) {
        return {
          cfg: upsertAccountConfig(cfg, accountId, {
            machineId: paired.machineId,
          }),
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      prompter?.note?.(
        `${CHANNEL_LABEL}: pair request failed (${message}). Settings were saved; retry with 'openclaw gateway restart'.`,
      );
    }
  },
  completionNote: {
    title: `${CHANNEL_LABEL} configured`,
    lines: [
      "Run 'openclaw gateway restart' to start the connection.",
      "Check status with 'openclaw channels status lycus'.",
    ],
  },
  disable: (cfg: OpenClawConfig) =>
    upsertAccountConfig(cfg, DEFAULT_ACCOUNT_ID, { enabled: false }),
};
