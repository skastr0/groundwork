import { Schema } from "effect";
import { defineTool } from "prism";
import { runGwTool } from "../hooks/shared/groundwork-runtime.ts";

const Input = Schema.Struct({
  root_dir: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  commit: Schema.optional(Schema.String),
  pr: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  start_line: Schema.optional(Schema.Number),
  end_line: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  max_items: Schema.optional(Schema.Number),
  max_bytes: Schema.optional(Schema.Number),
  include_patch: Schema.optional(Schema.Boolean),
  mode: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.String),
  start: Schema.optional(Schema.Number),
  end: Schema.optional(Schema.Number),
});

export default defineTool({
  name: "gw_hotspots",
  description: "Groundwork provenance tool `gw_hotspots` (embedded SDK, no CLI required).",
  input: Input,
  output: Schema.Struct({
    ok: Schema.Boolean,
    result: Schema.optional(Schema.Unknown),
    error: Schema.optional(Schema.String),
  }),
  async handle(input) {
    return runGwTool("gw_hotspots", input as Record<string, unknown>);
  },
});
