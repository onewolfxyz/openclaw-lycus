import { describe, expect, it } from "vitest";

import { DEFAULT_ACCOUNT_ID, DEFAULT_INBOUND_PATH } from "./constants.js";
import {
  inspectClawChannelAccount,
  listClawChannelAccountIds,
  resolveClawChannelAccount,
} from "./config.js";

describe("claw-channel config", () => {
  it("resolves a top-level default account", () => {
    const cfg = {
      channels: {
        "claw-channel": {
          baseUrl: "https://backend.example.com/",
          machineToken: "machine-token",
          machineId: "machine-default",
          allowFrom: ["user-1"],
        },
      },
    } as any;

    const account = resolveClawChannelAccount(cfg);

    expect(account.accountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(account.baseUrl).toBe("https://backend.example.com");
    expect(account.machineToken).toBe("machine-token");
    expect(account.machineId).toBe("machine-default");
    expect(account.mode).toBe("websocket");
    expect(account.socketUrl).toBe("wss://backend.example.com/cable");
    expect(account.allowFrom).toEqual(["user-1"]);
    expect(account.inboundPath).toBe(DEFAULT_INBOUND_PATH);
  });

  it("resolves named accounts over top-level defaults", () => {
    const cfg = {
      channels: {
        "claw-channel": {
          baseUrl: "https://backend.example.com",
          machineToken: "top-token",
          machineId: "top-machine",
          accounts: {
            west: {
              machineToken: "west-token",
              machineId: "machine-west",
            },
          },
        },
      },
    } as any;

    const account = resolveClawChannelAccount(cfg, "west");

    expect(account.accountId).toBe("west");
    expect(account.baseUrl).toBe("https://backend.example.com");
    expect(account.machineToken).toBe("west-token");
    expect(account.machineId).toBe("machine-west");
  });

  it("lists named accounts when configured", () => {
    const cfg = {
      channels: {
        "claw-channel": {
          accounts: {
            one: {},
            two: {},
          },
        },
      },
    } as any;

    expect(listClawChannelAccountIds(cfg)).toEqual(["one", "two"]);
  });

  it("inspects missing credentials without exposing secrets", () => {
    const result = inspectClawChannelAccount({ channels: {} } as any);

    expect(result.configured).toBe(false);
    expect(result.machineTokenStatus).toBe("missing");
  });
});
