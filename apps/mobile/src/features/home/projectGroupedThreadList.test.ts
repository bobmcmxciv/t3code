import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ThreadListV2ListItem } from "../threads/threadListV2";
import type { HomeProjectScope } from "./homeThreadList";
import { groupThreadListV2ItemsByProject } from "./projectGroupedThreadList";

function makeProject(env: string, id: string, title: string): EnvironmentProject {
  return {
    environmentId: EnvironmentId.make(env),
    id: ProjectId.make(id),
    title,
    workspaceRoot: `/repo/${id}`,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    archived: false,
    pinned: false,
  } as unknown as EnvironmentProject;
}

function makeThreadItem(env: string, projectId: string, id: string, title: string): ThreadListV2ListItem {
  const thread = {
    environmentId: EnvironmentId.make(env),
    projectId: ProjectId.make(projectId),
    id: ThreadId.make(id),
    title,
    createdAt: "2026-11-24T00:00:00.000Z",
    archivedAt: null,
    runtime: null,
    latestRun: null,
    lastVisitedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    pendingGuestMessageCount: 0,
    blockedOnThreadWait: false,
  } as unknown as EnvironmentThreadShell;
  return {
    type: "v2-thread",
    key: `v2-thread:${env}:${id}`,
    item: {
      thread,
      variant: "card",
      snoozed: false,
      pinned: false,
      wokeAt: null,
      isLast: false,
    },
    snoozeWakeLabelText: undefined,
    timeLabel: "1m",
    snoozePresetMinute: undefined,
    showTrailingDivider: true,
    hasQueuedMessages: false,
    canMoveUp: false,
    canMoveDown: false,
  };
}

describe("groupThreadListV2ItemsByProject", () => {
  const projA = makeProject("env-vircs", "p-alpha", "T3 Code");
  const projB = makeProject("env-mac", "p-beta", "Recording Helper");
  const scopes: HomeProjectScope[] = [
    {
      key: "scope-alpha",
      title: "T3 Code",
      representative: projA,
      projects: [projA],
      projectRefs: [{ environmentId: projA.environmentId, projectId: projA.id }],
      pinned: false,
      archived: false,
    },
    {
      key: "scope-beta",
      title: "Recording Helper",
      representative: projB,
      projects: [projB],
      projectRefs: [{ environmentId: projB.environmentId, projectId: projB.id }],
      pinned: false,
      archived: false,
    },
  ];
  const projectByKey = new Map<string, EnvironmentProject>([
    [`${projA.environmentId}:${projA.id}`, projA],
    [`${projB.environmentId}:${projB.id}`, projB],
  ]);

  it("groups active threads under prominent project headers and keeps settled shelf below", () => {
    const items: ThreadListV2ListItem[] = [
      makeThreadItem("env-vircs", "p-alpha", "t1", "Alpha 1"),
      makeThreadItem("env-mac", "p-beta", "t2", "Beta 1"),
      makeThreadItem("env-vircs", "p-alpha", "t3", "Alpha 2"),
      { type: "v2-settled-shelf", key: "v2-settled-shelf", count: 2, expanded: false, disabled: false },
    ];
    const grouped = groupThreadListV2ItemsByProject({
      items,
      projectScopes: scopes,
      projectByKey,
      savedConnectionsById: {
        "env-vircs": { environmentId: projA.environmentId, environmentLabel: "VIRCS" } as never,
        "env-mac": { environmentId: projB.environmentId, environmentLabel: "Mac" } as never,
      },
      collapsedProjectKeys: new Set(["scope-beta"]),
      enabled: true,
    });
    expect(grouped.projectGroupKeys).toEqual(["scope-alpha", "scope-beta"]);
    expect(grouped.items.map((item) => item.key)).toEqual([
      "v2-project-group:scope-alpha",
      "v2-thread:env-vircs:t1",
      "v2-thread:env-vircs:t3",
      "v2-project-group:scope-beta",
      "v2-settled-shelf",
    ]);
    const alphaHeader = grouped.items[0];
    expect(alphaHeader?.type === "v2-project-group" && alphaHeader.count).toBe(2);
    expect(alphaHeader?.type === "v2-project-group" && alphaHeader.environmentLabels).toEqual([
      "VIRCS",
    ]);
  });

  it("returns original flat order when disabled", () => {
    const items: ThreadListV2ListItem[] = [
      makeThreadItem("env-vircs", "p-alpha", "t1", "Alpha 1"),
      makeThreadItem("env-mac", "p-beta", "t2", "Beta 1"),
    ];
    const result = groupThreadListV2ItemsByProject({
      items,
      projectScopes: scopes,
      projectByKey,
      savedConnectionsById: {},
      collapsedProjectKeys: new Set(),
      enabled: false,
    });
    expect(result.items).toBe(items);
    expect(result.projectGroupKeys).toEqual([]);
  });
});
