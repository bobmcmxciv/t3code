import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import type { SavedRemoteConnection } from "../../lib/connection";
import { scopedProjectKey } from "../../lib/scopedEntities";
import {
  resolveThreadListV2RowStatus,
  threadListV2ListItemsAreEqual,
  type ThreadListV2ListItem,
  type ThreadListV2ThreadListItem,
} from "../threads/threadListV2";
import type { HomeProjectScope } from "./homeThreadList";

const PROJECT_ACCENT_PALETTE = [
  "#6366F1", // indigo
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EC4899", // pink
  "#0EA5E9", // sky
  "#8B5CF6", // violet
  "#14B8A6", // teal
  "#F97316", // orange
] as const;

export function projectAccentColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return PROJECT_ACCENT_PALETTE[Math.abs(hash) % PROJECT_ACCENT_PALETTE.length]!;
}

export interface HomeProjectGroupHeaderListItem {
  readonly type: "v2-project-group";
  readonly key: string;
  readonly scopeKey: string;
  readonly title: string;
  readonly count: number;
  readonly activeWorkingCount: number;
  readonly accentColor: string;
  readonly collapsed: boolean;
  readonly project: EnvironmentProject;
  readonly environmentLabels: readonly string[];
}

export type HomeDisplayListItem = ThreadListV2ListItem | HomeProjectGroupHeaderListItem;

export function homeDisplayListItemsAreEqual(
  previous: HomeDisplayListItem,
  item: HomeDisplayListItem,
): boolean {
  if (item.type === "v2-project-group") {
    return (
      previous.type === "v2-project-group" &&
      previous.key === item.key &&
      previous.title === item.title &&
      previous.count === item.count &&
      previous.activeWorkingCount === item.activeWorkingCount &&
      previous.accentColor === item.accentColor &&
      previous.collapsed === item.collapsed &&
      previous.project === item.project &&
      previous.environmentLabels.length === item.environmentLabels.length &&
      previous.environmentLabels.every((label, index) => label === item.environmentLabels[index])
    );
  }
  if (previous.type === "v2-project-group") return false;
  return threadListV2ListItemsAreEqual(previous, item);
}

export function groupThreadListV2ItemsByProject(input: {
  readonly items: readonly ThreadListV2ListItem[];
  readonly projectScopes: readonly HomeProjectScope[];
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly savedConnectionsById: Readonly<Record<string, SavedRemoteConnection>>;
  readonly collapsedProjectKeys: ReadonlySet<string>;
  readonly enabled: boolean;
}): {
  readonly items: readonly HomeDisplayListItem[];
  readonly projectGroupKeys: readonly string[];
} {
  if (!input.enabled) {
    return { items: input.items, projectGroupKeys: [] };
  }

  const scopeByProjectKey = new Map<string, HomeProjectScope>();
  for (const scope of input.projectScopes) {
    for (const ref of scope.projectRefs) {
      scopeByProjectKey.set(scopedProjectKey(ref.environmentId, ref.projectId), scope);
    }
  }

  const pendingItems: ThreadListV2ListItem[] = [];
  const activeThreads: ThreadListV2ThreadListItem[] = [];
  const shelfTail: ThreadListV2ListItem[] = [];
  let inShelf = false;

  for (const item of input.items) {
    if (
      item.type === "v2-working-shelf" ||
      item.type === "v2-snoozed-shelf" ||
      item.type === "v2-settled-shelf"
    ) {
      inShelf = true;
    }
    if (inShelf) {
      shelfTail.push(item);
      continue;
    }
    if (item.type === "v2-pending") {
      pendingItems.push(item);
    } else if (item.type === "v2-thread") {
      activeThreads.push(item);
    }
  }

  if (activeThreads.length === 0) {
    return { items: input.items, projectGroupKeys: [] };
  }

  const multiHost = Object.keys(input.savedConnectionsById).length > 1;
  const groups: Array<{
    readonly scopeKey: string;
    readonly title: string;
    readonly project: EnvironmentProject;
    readonly envLabels: Set<string>;
    readonly threads: ThreadListV2ThreadListItem[];
    workingCount: number;
  }> = [];
  const groupByScopeKey = new Map<string, (typeof groups)[number]>();
  const orphanThreads: ThreadListV2ThreadListItem[] = [];

  for (const threadItem of activeThreads) {
    const thread = threadItem.item.thread;
    const rawKey = scopedProjectKey(thread.environmentId, thread.projectId);
    const scope = scopeByProjectKey.get(rawKey);
    const project = scope?.representative ?? input.projectByKey.get(rawKey);
    if (!project) {
      orphanThreads.push(threadItem);
      continue;
    }
    const scopeKey = scope?.key ?? rawKey;
    let group = groupByScopeKey.get(scopeKey);
    if (!group) {
      group = {
        scopeKey,
        title: scope?.title ?? project.title,
        project,
        envLabels: new Set<string>(),
        threads: [],
        workingCount: 0,
      };
      groupByScopeKey.set(scopeKey, group);
      groups.push(group);
    }
    if (multiHost) {
      const envLabel = input.savedConnectionsById[thread.environmentId]?.environmentLabel;
      if (envLabel) group.envLabels.add(envLabel);
    }
    const status = resolveThreadListV2RowStatus(thread);
    if (status === "working" || status === "approval" || status === "input") {
      group.workingCount += 1;
    }
    group.threads.push(threadItem);
  }

  const result: HomeDisplayListItem[] = [...pendingItems];
  const projectGroupKeys: string[] = [];

  for (const group of groups) {
    const collapsed = input.collapsedProjectKeys.has(group.scopeKey);
    projectGroupKeys.push(group.scopeKey);
    result.push({
      type: "v2-project-group",
      key: `v2-project-group:${group.scopeKey}`,
      scopeKey: group.scopeKey,
      title: group.title,
      count: group.threads.length,
      activeWorkingCount: group.workingCount,
      accentColor: projectAccentColor(group.scopeKey),
      collapsed,
      project: group.project,
      environmentLabels: [...group.envLabels],
    });
    if (!collapsed) {
      for (let i = 0; i < group.threads.length; i += 1) {
        const entry = group.threads[i]!;
        const showTrailingDivider = i < group.threads.length - 1;
        result.push(
          entry.showTrailingDivider === showTrailingDivider
            ? entry
            : { ...entry, showTrailingDivider },
        );
      }
    }
  }

  result.push(...orphanThreads, ...shelfTail);
  return { items: result, projectGroupKeys };
}
