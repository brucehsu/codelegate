/**
 * Git control plane: thin adapters from the `window.codelegate` argument
 * shapes to the positional native addon surface. Every one of these runs on
 * the libuv pool inside the addon, so nothing here blocks the main thread.
 */
import { IPC } from "../../shared/channels";
import type { CommitGitChangesArgs, GitFileDiffArgs, RemoveSessionWorktreeArgs } from "../../shared/types";
import type { NativeAddon } from "../native";
import type { IpcHandle } from "./register";

export function registerGitIpc(handle: IpcHandle, native: NativeAddon): void {
  handle(IPC.GET_GIT_BRANCH, (_event, repoPath: string) => native.getGitBranch(repoPath));
  handle(IPC.LIST_GIT_BRANCHES, (_event, repoPath: string) => native.listGitBranches(repoPath));
  handle(IPC.RENAME_GIT_BRANCH, (_event, repoPath: string, name: string) =>
    native.renameGitBranch(repoPath, name),
  );
  handle(IPC.GET_GIT_CHANGE_SUMMARY, (_event, repoPath: string) => native.getGitChangeSummary(repoPath));
  handle(IPC.GET_GIT_FILE_DIFF, (_event, args: GitFileDiffArgs) =>
    native.getGitFileDiff(args.path, args.section, args.filePath, args.oldPath ?? null),
  );
  handle(IPC.STAGE_ALL_CHANGES, (_event, repoPath: string) => native.stageAllChanges(repoPath));
  handle(IPC.UNSTAGE_ALL_CHANGES, (_event, repoPath: string) => native.unstageAllChanges(repoPath));
  handle(IPC.DISCARD_ALL_CHANGES, (_event, repoPath: string) => native.discardAllChanges(repoPath));
  handle(IPC.STAGE_FILE_CHANGE, (_event, repoPath: string, filePath: string) =>
    native.stageFileChange(repoPath, filePath),
  );
  handle(IPC.UNSTAGE_FILE_CHANGE, (_event, repoPath: string, filePath: string) =>
    native.unstageFileChange(repoPath, filePath),
  );
  handle(IPC.COMMIT_GIT_CHANGES, (_event, args: CommitGitChangesArgs) =>
    native.commitGitChanges(args.path, args.message, args.amend),
  );
  handle(IPC.GET_LAST_COMMIT_MESSAGE, (_event, repoPath: string) => native.getLastCommitMessage(repoPath));
  handle(IPC.REMOVE_SESSION_WORKTREE, (_event, args: RemoveSessionWorktreeArgs) =>
    native.removeSessionWorktree(args.repoPath, args.worktreePath, args.branch ?? null),
  );
}
