export const GROUNDWORK_SDK_INFO = {
  name: "@skastr0/groundwork",
  version: "0.2.1",
  surfaces: ["cli", "core", "prism"] as const,
  packages: {
    core: "@skastr0/groundwork-core",
    prismPlugin: "prism-plugin/",
  },
} as const;

export type GroundworkSdkSurface = (typeof GROUNDWORK_SDK_INFO.surfaces)[number];
