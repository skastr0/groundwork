export const GROUNDWORK_SDK_INFO = {
  name: "@skastr0/groundwork",
  version: "0.1.0",
  surfaces: ["policy", "context", "provenance", "risk"] as const,
  pluginExport: "GroundworkPlugin",
} as const;

export type GroundworkSdkSurface = (typeof GROUNDWORK_SDK_INFO.surfaces)[number];
