export {
  LOCAL_BASE_DETECTION_KIND_VALUES,
  LOCAL_FILE_COMPARISON_STATUS_VALUES,
  LOCAL_REPO_AMBIGUITY_CODE_VALUES,
  LOCAL_REPO_FILE_STATUS_VALUES,
  type LocalBaseDetection,
  type LocalBaseDetectionKind,
  type LocalBaseState,
  type LocalCurrentBranchState,
  type LocalFileComparison,
  type LocalFileComparisonStatus,
  type LocalFileLayerState,
  type LocalFileState,
  type LocalHeadState,
  type LocalIndexState,
  type LocalRepoAmbiguityCode,
  type LocalRepoAmbiguityIssue,
  type LocalRepoAmbiguityState,
  type LocalRepoFileStatus,
  type LocalRepoFileStatusKind,
  type LocalRepoState,
  type LocalUntrackedFilesState,
  type LocalWorktreeState,
  type Shell,
} from "./types.ts";
export {
  detectLocalBaseState,
  getCurrentBranchState,
  getHeadState,
} from "./base-detection.ts";
export {
  getIndexState,
  getUntrackedFiles,
  getWorktreeState,
  resolveLocalRepoState,
} from "./repo-state.ts";
export { resolveLocalFileState } from "./file-state.ts";
