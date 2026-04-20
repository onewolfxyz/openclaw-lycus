import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { clawChannelPlugin, registerRuntimeApi } from "./src/channel.js";
import { pairMachine } from "./src/client.js";
import { CHANNEL_ID, CHANNEL_LABEL, DEFAULT_ACCOUNT_ID } from "./src/constants.js";
import { resolveClawChannelAccount } from "./src/config.js";
import type { RuntimeApi } from "./src/inbound.js";

type CliProgram = {
  command: (name: string) => CliCommand;
};

type CliCommand = {
  description: (text: string) => CliCommand;
  option: (flags: string, description: string, defaultValue?: string) => CliCommand;
  action: (handler: (opts: { account?: string; machineToken?: string }) => Promise<void>) => CliCommand;
  command: (name: string) => CliCommand;
};

type EntryApi = {
  config: Record<string, unknown>;
  logger: {
    info: (message: string) => void;
  };
  registerCli: (
    registrar: (ctx: {
      program: CliProgram;
      config: Record<string, unknown>;
      logger: { info: (message: string) => void };
    }) => void,
    options: {
      descriptors: Array<{
        name: string;
        description: string;
        hasSubcommands: boolean;
      }>;
    },
  ) => void;
};

export default defineChannelPluginEntry({
  id: CHANNEL_ID,
  name: CHANNEL_LABEL,
  description:
    "Channel plugin that connects OpenClaw to Lycus.",
  plugin: clawChannelPlugin,
  registerCliMetadata(api: EntryApi) {
    api.registerCli(
      ({ program, config, logger }) => {
        const root = program
          .command(CHANNEL_ID)
          .description("Lycus channel management");

        root
          .command("pair")
          .description("Pair this OpenClaw gateway with Lycus")
          .option("-a, --account <id>", "channel account id", DEFAULT_ACCOUNT_ID)
          .option("--machine-token <token>", "override configured machine token")
          .action(async (opts: { account?: string; machineToken?: string }) => {
            const account = resolveClawChannelAccount(config, opts.account);
            const paired = await pairMachine(
              opts.machineToken ? { ...account, machineToken: opts.machineToken } : account,
            );

            logger.info(
              `${CHANNEL_LABEL}: paired account ${paired.accountId} (${paired.machineId})`,
            );
          });
      },
      {
        descriptors: [
          {
            name: CHANNEL_ID,
            description: "Lycus channel management",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
  registerFull(api: RuntimeApi) {
    registerRuntimeApi(api);
  },
});
