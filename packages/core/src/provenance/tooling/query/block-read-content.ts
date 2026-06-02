import { type ProvenanceContentLayer } from "../args.ts";
import {
  type LocalFileLayerState,
  type LocalFileState,
} from "../state/internal.ts";
import { createLocalToolFailure, toErrorMessage } from "../shared.ts";
import {
  applyBlockLineBudget,
  buildBlockContentHints,
  buildBlockLines,
  getSelectedLayerState,
  normalizeTextLines,
  readSelectedLayerText,
  resolveRequestedWindow,
} from "./content.ts";
import {
  GW_BLOCK_READ_TOOL,
  type ProvBlockContent,
  type RequestedBlockSpan,
  type ResolvedBlockWindow,
} from "./schemas.ts";
import type {
  BlockReadToolInput,
  QueryToolRuntimeOptions,
} from "./runtime.ts";

type BlockContentLayerText = {
  selectedLayer: LocalFileLayerState;
  textLines: string[];
  totalLines: number;
};

type BlockContentWindow = {
  focus: RequestedBlockSpan;
  window: ResolvedBlockWindow;
};

export async function resolveBlockReadContent(params: {
  input: BlockReadToolInput;
  runtimeOptions: QueryToolRuntimeOptions;
  rootDir: string;
  selectedLayerName: ProvenanceContentLayer;
  fileState: LocalFileState;
}): Promise<
  | string
  | {
      selectedLayer: LocalFileLayerState;
      content: ProvBlockContent;
    }
> {
  const { input, runtimeOptions, rootDir, selectedLayerName, fileState } = params;
  const layerText = await loadBlockContentLayerText({
    runtimeOptions,
    rootDir,
    selectedLayerName,
    fileState,
  });

  const rangeFailure = validateBlockContentRange(input, selectedLayerName, layerText);
  if (rangeFailure) {
    return rangeFailure;
  }

  const window = resolveBlockContentWindow(input, layerText.totalLines);
  if (typeof window === "string") {
    return window;
  }

  return {
    selectedLayer: layerText.selectedLayer,
    content: assembleBlockReadContent({
      input,
      selectedLayerName,
      layerText,
      window,
    }),
  };
}

async function loadBlockContentLayerText(params: {
  runtimeOptions: QueryToolRuntimeOptions;
  rootDir: string;
  selectedLayerName: ProvenanceContentLayer;
  fileState: LocalFileState;
}): Promise<BlockContentLayerText> {
  const selectedLayer = getSelectedLayerState(params.fileState, params.selectedLayerName);
  const rawText = await readSelectedLayerText({
    shell: params.runtimeOptions.shell,
    rootDir: params.rootDir,
    layer: params.selectedLayerName,
    selectedLayer,
  });
  const textLines = normalizeTextLines(rawText);

  return {
    selectedLayer,
    textLines,
    totalLines: textLines.length,
  };
}

function validateBlockContentRange(
  input: BlockReadToolInput,
  selectedLayerName: ProvenanceContentLayer,
  layerText: BlockContentLayerText,
): string | undefined {
  if (
    !layerText.selectedLayer.exists ||
    (layerText.totalLines > 0 &&
      input.start_line <= layerText.totalLines &&
      input.end_line <= layerText.totalLines)
  ) {
    return undefined;
  }

  return createBlockValidationFailure({
    requestedPath: input.path,
    summary: `Requested block '${input.path}:${input.start_line}-${input.end_line}' is outside the selected layer.`,
    code: "BLOCK_RANGE_OUT_OF_BOUNDS",
    message: `Requested block exceeds the selected ${selectedLayerName} layer length of ${layerText.totalLines} line(s).`,
  });
}

function resolveBlockContentWindow(
  input: BlockReadToolInput,
  totalLines: number,
): string | BlockContentWindow {
  try {
    return {
      focus: {
        startLine: input.start_line,
        endLine: input.end_line,
      },
      window: resolveRequestedWindow({
        startLine: input.start_line,
        endLine: input.end_line,
        radius: input.radius,
        windowStart: input.window_start,
        windowEnd: input.window_end,
        totalLines,
      }),
    };
  } catch (error) {
    return createBlockValidationFailure({
      requestedPath: input.path,
      summary: `Invalid block window for '${input.path}:${input.start_line}-${input.end_line}'.`,
      code: "BLOCK_WINDOW_INVALID",
      message: toErrorMessage(error),
    });
  }
}

function createBlockValidationFailure(options: {
  requestedPath: string;
  summary: string;
  code: string;
  message: string;
}): string {
  return createLocalToolFailure({
    tool: GW_BLOCK_READ_TOOL,
    ...options,
  });
}

function assembleBlockReadContent(params: {
  input: BlockReadToolInput;
  selectedLayerName: ProvenanceContentLayer;
  layerText: BlockContentLayerText;
  window: BlockContentWindow;
}): ProvBlockContent {
  const { input, selectedLayerName, layerText, window } = params;
  const boundedBlock = applyBlockLineBudget(
    buildBlockLines({
      lines: layerText.textLines,
      focus: window.focus,
      window: window.window,
    }),
    input.max_bytes,
  );

  return {
    layer: selectedLayerName,
    ref: layerText.selectedLayer.ref,
    path: layerText.selectedLayer.path,
    exists: layerText.selectedLayer.exists,
    focus: window.focus,
    window: window.window,
    totalLines: layerText.totalLines,
    lines: boundedBlock.lines,
    text: boundedBlock.text,
    bounds: boundedBlock.bounds,
    byteCount: boundedBlock.byteCount,
    hints: buildBlockContentHints({
      layer: selectedLayerName,
      selectedLayer: layerText.selectedLayer,
      window: window.window,
      bounds: boundedBlock.bounds,
      byteCount: boundedBlock.byteCount,
    }),
    confidence: layerText.selectedLayer.confidence,
    detectionMethod: layerText.selectedLayer.detectionMethod,
  };
}
