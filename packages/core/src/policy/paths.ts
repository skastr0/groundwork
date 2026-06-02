import path from "node:path";

export function normalizePathForMatching(rootDir: string, target: string): string {
  const absolute = path.isAbsolute(target) ? target : path.resolve(rootDir, target);
  const relative = path.relative(rootDir, absolute);
  const withoutLeading = relative.startsWith(`..${path.sep}`) ? absolute : relative;
  return withoutLeading.split(path.sep).join("/");
}
