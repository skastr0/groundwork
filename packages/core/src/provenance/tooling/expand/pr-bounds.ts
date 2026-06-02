import {
  DEFAULT_PROVENANCE_BYTE_LIMIT,
  resolveBoundedNumber,
} from "../args.ts";
import type { BoundedText } from "./schemas.ts";

export function buildBoundedText(
  value: string | null | undefined,
  requested: number | undefined,
): BoundedText {
  const text = (value ?? "").trim();
  const limit = resolveBoundedNumber(requested, DEFAULT_PROVENANCE_BYTE_LIMIT);
  const byteCount = Buffer.byteLength(text, "utf8");

  if (byteCount <= limit) {
    return {
      text,
      bounds: {
        requested,
        limit,
        returned: byteCount,
        truncated: false,
      },
      byteCount,
    };
  }

  const suffix = "... [truncated]";
  let end = text.length;
  while (end > 0 && Buffer.byteLength(`${text.slice(0, end)}${suffix}`, "utf8") > limit) {
    end -= 1;
  }

  const truncatedText =
    end > 0 ? `${text.slice(0, end).trimEnd()}${suffix}` : suffix.slice(0, limit);

  return {
    text: truncatedText,
    bounds: {
      requested,
      limit,
      returned: Buffer.byteLength(truncatedText, "utf8"),
      truncated: true,
    },
    byteCount,
  };
}
