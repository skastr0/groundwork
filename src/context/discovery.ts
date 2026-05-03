import { promises as fs } from "node:fs";
import path from "node:path";

export const FRAMEWORK_CONTEXT_RULE_FILES: readonly ["AGENTS.md", "CLAUDE.md"] = [
  "AGENTS.md",
  "CLAUDE.md",
];

export type FrameworkContextRuleFileName = (typeof FRAMEWORK_CONTEXT_RULE_FILES)[number];

export interface FrameworkDiscoveredContextFile {
  path: string;
  content: string;
  fileName: FrameworkContextRuleFileName;
}

export interface DiscoverFrameworkContextFilesOptions {
  targetPath: string;
  directory: string;
  rootDir: string;
  fileExists?: (filePath: string) => Promise<boolean>;
  readText?: (filePath: string) => Promise<string>;
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function defaultReadText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

function isOutsideRoot(relativePath: string): boolean {
  return relativePath.startsWith("..") || path.isAbsolute(relativePath);
}

export async function discoverFrameworkContextFiles(
  options: DiscoverFrameworkContextFilesOptions,
): Promise<FrameworkDiscoveredContextFile[]> {
  const directory = path.resolve(options.directory);
  const rootDir = path.resolve(options.rootDir);
  const targetPath = path.isAbsolute(options.targetPath)
    ? path.normalize(options.targetPath)
    : path.resolve(directory, options.targetPath);
  const fileExists = options.fileExists ?? defaultFileExists;
  const readText = options.readText ?? defaultReadText;
  const startDir = path.dirname(targetPath);
  const relativeStartDir = path.relative(rootDir, startDir);

  if (!relativeStartDir || relativeStartDir === "." || isOutsideRoot(relativeStartDir)) {
    return [];
  }

  const results: FrameworkDiscoveredContextFile[] = [];
  let currentDir = startDir;

  while (currentDir !== rootDir && currentDir !== path.dirname(currentDir)) {
    for (const fileName of FRAMEWORK_CONTEXT_RULE_FILES) {
      const candidatePath = path.join(currentDir, fileName);
      if (!(await fileExists(candidatePath))) {
        continue;
      }

      const content = await readText(candidatePath).catch(() => "");
      if (content) {
        results.push({
          path: candidatePath,
          content,
          fileName,
        });
      }

      break;
    }

    currentDir = path.dirname(currentDir);
  }

  return results.reverse();
}
