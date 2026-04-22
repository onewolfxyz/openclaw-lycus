declare module "openclaw/plugin-sdk/core" {
  export type OpenClawConfig = Record<string, any>;

  export function defineChannelPluginEntry(entry: any): any;

  export function defineSetupPluginEntry(plugin: any): any;
}
