export const GROUNDWORK_SDK_INFO = {
  name: "@skastr0/groundwork",
  version: "0.2.1",
  surfaces: ["cli", "core", "opencode", "codex"] as const,
  packages: {
    core: "@skastr0/groundwork-core",
    codex: "@skastr0/groundwork-codex",
    opencode: "@skastr0/groundwork-opencode-plugin",
  },
} as const;

export type GroundworkSdkSurface = (typeof GROUNDWORK_SDK_INFO.surfaces)[number];
