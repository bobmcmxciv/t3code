import type { DraftId } from "~/composerDraftStore";
import { composerDraftHasUserContent, useComposerDraftStore } from "~/composerDraftStore";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { T, useGT, Var } from "gt-react";
import { FolderPlusIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { cn } from "~/lib/utils";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useOrderWhileOpen } from "~/hooks/useOrderWhileOpen";
import { useProjectPin } from "~/hooks/useProjectGroupUpdate";
import { useScratchProject } from "~/hooks/useScratchProject";
import { isTriagePrompt } from "@t3tools/shared/triagePrompt";
import { useClientSettings } from "~/hooks/useSettings";
import { seedDraftModelSelection } from "~/lib/seedDraftModelSelection";
import {
  deriveLogicalProjectKeyFromSettings,
  pickableProjectGroups,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { buildSidebarProjectPickerEntries } from "~/sidebarProjectGrouping";
import { useProjects } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { isProjectPinShortcut, ProjectPinButton } from "../ProjectPinButton";
import { useSortedProjectGroups } from "../CommandPaletteLookups";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { InlineButton } from "../ui/button";
import { DraftProjectName } from "./DraftProjectName";
import { DraftHeroProjectHeading } from "./DraftHeroProjectHeading";
import { TriageDraftHero } from "./TriageDraftHero";

const ADD_PROJECT_VALUE = "add-project";

interface PickerItem {
  readonly value: string;
  readonly label: string;
}

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const gt = useGT();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  // A boolean, so typing in a draft does not re-render the hero.
  const isTriageDraftPrompt = useComposerDraftStore((store) =>
    draftId ? isTriagePrompt(store.getComposerDraft(draftId)?.prompt ?? "") : false,
  );
  const openAddProject = () => openCommandPalette({ open: "add-project" });
  const { scratchEnvironmentId, scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const openProjectDraft = useNewThreadHandler();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [selectedMachineId, setSelectedMachineId] = useState<EnvironmentId | null>(null);
  const pickerFilter = useComboboxFilter();
  const highlightedPickerValueRef = useRef<string | null>(null);
  const { canPinProjectGroup, toggleProjectGroupPin } = useProjectPin();

  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const projectGroups = useSortedProjectGroups(environmentLabelById);
  const environmentMachineById = new Map(
    environments.map(
      (environment) =>
        [
          environment.environmentId,
          resolveEnvironmentMachineKind(environment.serverConfig),
        ] as const,
    ),
  );
  const projectPickerEntries = buildSidebarProjectPickerEntries({
    groups: pickableProjectGroups(projectGroups),
    preferredProjectRef: activeProjectRef,
  });
  const projectEntryByKey = new Map(
    projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const),
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;
  const menuEntries = projectPickerEntries.filter(
    ({ targetProject }) =>
      !isScratchProject(targetProject, scratchWorkspaceRootFor(targetProject.environmentId)),
  );
  const machineOptions = environments
    .map((environment) => {
      const count = menuEntries.filter(({ group }) =>
        group.memberProjects.some((member) => member.environmentId === environment.environmentId),
      ).length;
      return {
        environmentId: environment.environmentId,
        label: environment.label,
        machine: resolveEnvironmentMachineKind(environment.serverConfig),
        count,
      };
    })
    .filter((option) => option.count > 0);
  const hasMultipleMachines = machineOptions.length > 1;
  const effectiveMachineFilter =
    selectedMachineId !== null &&
    machineOptions.some((option) => option.environmentId === selectedMachineId)
      ? selectedMachineId
      : null;
  const machineFilteredEntries =
    effectiveMachineFilter === null
      ? menuEntries
      : menuEntries.filter(({ group }) =>
          group.memberProjects.some((member) => member.environmentId === effectiveMachineFilter),
        );
  const activeProject =
    activeProjectRef === null
      ? null
      : (projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        ) ?? null);
  const scratchTargetEnvironmentId = scratchEnvironmentId(activeProjectRef?.environmentId ?? null);
  const scratchWorkspaceRoot = scratchWorkspaceRootFor(scratchTargetEnvironmentId);
  const isScratchDraft =
    activeProject !== null &&
    isScratchProject(activeProject, scratchWorkspaceRootFor(activeProject.environmentId));

  // Pinning from a row keeps rows in place while the picker is open.
  const pickerItems: readonly PickerItem[] = useOrderWhileOpen(
    [
      ...machineFilteredEntries.map(({ group }) => ({
        value: group.projectKey,
        label: group.displayName,
      })),
      { value: ADD_PROJECT_VALUE, label: gt("Add project") },
    ],
    (item) => item.value,
    pickerOpen,
  );
  const pickerSearch = pickerQuery.trim();
  const filteredPickerItems =
    pickerSearch.length === 0
      ? pickerItems
      : pickerItems.filter((item) => {
          if (item.value === ADD_PROJECT_VALUE) return false;
          if (pickerFilter.contains(item, pickerSearch, (candidate) => candidate.label)) {
            return true;
          }
          const entry = projectEntryByKey.get(item.value);
          if (!entry) return false;
          const envLabels = entry.group.memberProjects
            .map((member) => environmentLabelById.get(member.environmentId) ?? member.environmentLabel ?? "")
            .join(" ");
          return pickerFilter.contains(
            { value: item.value, label: envLabels },
            pickerSearch,
            (candidate) => candidate.label,
          );
        });
  const selectedPickerItem = pickerItems.find((item) => item.value === activeProjectKey) ?? null;

  // The picker can change the draft's target while the no-project home is
  // still being opened; a stale continuation must not retarget it again. Picking
  // a project clears the pending request, and the draft session is compared
  // against the store when the scratch project arrives.
  const pendingScratchRef = useRef<symbol | null>(null);
  const draftTargetKey = () => {
    const session = draftId ? useComposerDraftStore.getState().getDraftSession(draftId) : null;
    return session
      ? `${session.environmentId}:${session.projectId}:${session.logicalProjectKey}`
      : null;
  };
  // Retargeting an empty draft would overwrite the project's draft and strand browser tabs.
  const selectProject = (project: (typeof projects)[number], logicalProjectKey: string) => {
    if (!draftId) {
      return;
    }
    pendingScratchRef.current = null;
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    if (!composerDraftHasUserContent(getComposerDraft(draftId))) {
      void openProjectDraft(projectRef);
      return;
    }
    setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId);
    seedDraftModelSelection(draftId, projectRef);
  };
  const startScratch = async (): Promise<boolean> => {
    if (scratchTargetEnvironmentId === null || isScratchDraft) {
      return false;
    }
    const request = Symbol("scratch");
    pendingScratchRef.current = request;
    const requestedTarget = draftTargetKey();
    const project = await openScratchProject(scratchTargetEnvironmentId);
    if (!project || pendingScratchRef.current !== request || draftTargetKey() !== requestedTarget) {
      return false;
    }
    pendingScratchRef.current = null;
    selectProject(project, deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings));
    return true;
  };

  const projectSelector = shouldShowProjectMenu ? (
    <Combobox
      items={pickerItems}
      filteredItems={filteredPickerItems}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={pickerOpen}
      onItemHighlighted={(item) => {
        highlightedPickerValueRef.current = item?.value ?? null;
      }}
      onOpenChange={(open) => {
        setPickerOpen(open);
        setPickerQuery("");
      }}
      value={selectedPickerItem}
      onValueChange={(item) => {
        if (!item) return;
        setPickerOpen(false);
        if (item.value === ADD_PROJECT_VALUE) {
          openAddProject();
          return;
        }
        const entry = projectEntryByKey.get(item.value);
        if (!entry) {
          return;
        }
        const matchedTarget =
          effectiveMachineFilter !== null
            ? (projects.find(
                (candidate) =>
                  candidate.environmentId === effectiveMachineFilter &&
                  entry.group.memberProjectRefs.some(
                    (ref) =>
                      ref.environmentId === candidate.environmentId &&
                      ref.projectId === candidate.id,
                  ),
              ) ?? entry.targetProject)
            : entry.targetProject;
        if (
          activeProjectRef &&
          matchedTarget.environmentId === activeProjectRef.environmentId &&
          matchedTarget.id === activeProjectRef.projectId
        ) {
          return;
        }
        selectProject(matchedTarget, entry.group.projectKey);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              render={<InlineButton tone="picker" />}
              data-draft-project-trigger=""
              className="pointer-events-auto min-w-0 max-w-full align-baseline"
            />
          }
        >
          <DraftProjectName
            value={
              isScratchDraft ? gt("No project") : (activeProjectTitle ?? gt("Choose a project"))
            }
            singleLine
          />
        </TooltipTrigger>
        {activeProjectTitle && !isScratchDraft ? (
          <TooltipPopup side="top">{activeProjectTitle}</TooltipPopup>
        ) : null}
      </Tooltip>
      <ComboboxPopup align="center" className="w-80 overflow-hidden sm:w-96">
        <ComboboxSearchInput
          aria-label={gt("Search projects")}
          placeholder={gt("Search projects...")}
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
          onKeyDown={(event) => {
            const highlighted = highlightedPickerValueRef.current;
            const group = highlighted ? projectEntryByKey.get(highlighted)?.group : undefined;
            if (!group || !canPinProjectGroup(group) || !isProjectPinShortcut(event, keybindings)) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            toggleProjectGroupPin(group);
          }}
        />
        {hasMultipleMachines ? (
          <div
            data-testid="draft-project-machine-filter"
            className="flex items-center gap-1 overflow-x-auto border-b border-border/60 bg-muted/25 px-2.5 py-2"
          >
            <button
              type="button"
              onClick={() => setSelectedMachineId(null)}
              className={cn(
                "shrink-0 cursor-pointer rounded-full px-2.5 py-0.5 text-2xs font-medium transition-colors",
                effectiveMachineFilter === null
                  ? "bg-foreground text-background"
                  : "bg-background/80 text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <T>All machines</T>
            </button>
            {machineOptions.map((option) => {
              const isSelected = effectiveMachineFilter === option.environmentId;
              return (
                <button
                  key={option.environmentId}
                  type="button"
                  onClick={() => setSelectedMachineId(option.environmentId)}
                  className={cn(
                    "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-0.5 text-2xs font-medium transition-colors",
                    isSelected
                      ? "bg-foreground text-background"
                      : "bg-background/80 text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <EnvironmentMachineIcon
                    aria-hidden
                    kind={option.machine}
                    className="size-3 shrink-0"
                  />
                  <span className="max-w-28 truncate">{option.label}</span>
                  <span className={cn("tabular-nums opacity-65")}>{option.count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <ComboboxEmpty>
          <T>No matching projects.</T>
        </ComboboxEmpty>
        <ComboboxList>
          {(item: PickerItem) => {
            const entry = projectEntryByKey.get(item.value);
            const rowEnvironmentId =
              effectiveMachineFilter ?? entry?.targetProject.environmentId ?? null;
            const rowEnvironmentLabel = rowEnvironmentId
              ? (environmentLabelById.get(rowEnvironmentId) ?? null)
              : null;
            const rowMachineKind = rowEnvironmentId
              ? (environmentMachineById.get(rowEnvironmentId) ?? "server")
              : "server";
            return (
              <ComboboxItem key={item.value} hideIndicator value={item}>
                {item.value === ADD_PROJECT_VALUE ? (
                  <FolderPlusIcon className="size-4 shrink-0" />
                ) : entry ? (
                  <ProjectFavicon project={entry.group} className="size-4 shrink-0" />
                ) : null}
                <Tooltip>
                  <TooltipTrigger render={<span className="min-w-0 flex-1 text-sm" />}>
                    <DraftProjectName value={item.label} />
                  </TooltipTrigger>
                  <TooltipPopup side="top">{item.label}</TooltipPopup>
                </Tooltip>
                {entry && canPinProjectGroup(entry.group) ? (
                  <ProjectPinButton
                    name={entry.group.displayName}
                    pinned={entry.group.pinned}
                    shortcutLabel={shortcutLabelForCommand(keybindings, "thread.pin")}
                    onToggle={() => toggleProjectGroupPin(entry.group)}
                  />
                ) : null}
                {entry && hasMultipleMachines && rowEnvironmentLabel ? (
                  <span className="inline-flex max-w-28 shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-2xs text-muted-foreground">
                    <EnvironmentMachineIcon
                      aria-hidden
                      kind={rowMachineKind}
                      className="size-3 shrink-0"
                    />
                    <span className="truncate">{rowEnvironmentLabel}</span>
                  </span>
                ) : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline min-w-0 max-w-full cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <DraftProjectName value={activeProjectTitle ?? gt("Add a project")} singleLine />
    </button>
  );

  const noProjectShortcut = shortcutLabelForCommand(keybindings, "chat.newWithoutProject");
  const orStartWithoutProject =
    scratchWorkspaceRoot !== null && !isScratchDraft && (hasResolvedProject || canChooseProject) ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              tone="muted"
              className="pointer-events-auto"
              onClick={() =>
                void startScratch().then((started) => {
                  if (started) {
                    document.querySelector<HTMLElement>("[data-draft-project-trigger]")?.focus();
                  }
                })
              }
            />
          }
        >
          <T>or start without a project</T>
        </TooltipTrigger>
        {noProjectShortcut ? <TooltipPopup side="bottom">{noProjectShortcut}</TooltipPopup> : null}
      </Tooltip>
    ) : null;

  if (isScratchDraft && isTriageDraftPrompt) {
    const environment = environments.find(
      (entry) => entry.environmentId === activeProject.environmentId,
    );
    return (
      <TriageDraftHero
        machineLabel={environment?.label ?? null}
        serverVersion={environment?.serverConfig?.environment.serverVersion ?? null}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
      {hasMultipleMachines && shouldShowProjectMenu ? (
        <div
          data-testid="draft-hero-machine-bar"
          className="pointer-events-auto mb-3 flex max-w-full flex-wrap items-center justify-center gap-1.5"
        >
          {machineOptions.map((option) => {
            const isCurrentMachine = activeProjectRef?.environmentId === option.environmentId;
            return (
              <button
                key={option.environmentId}
                type="button"
                onClick={() => {
                  setSelectedMachineId(option.environmentId);
                  setPickerOpen(true);
                }}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  isCurrentMachine
                    ? "border-foreground/25 bg-accent/80 text-foreground shadow-2xs"
                    : "border-border/60 bg-background/70 text-muted-foreground hover:border-border hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <EnvironmentMachineIcon
                  aria-hidden
                  kind={option.machine}
                  className="size-3.5 shrink-0"
                />
                <span className="max-w-36 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {hasResolvedProject && !isScratchDraft ? (
        <DraftHeroProjectHeading projectName={activeProjectTitle ?? gt("Choose a project")}>
          {projectSelector}
        </DraftHeroProjectHeading>
      ) : (
        <h1 className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
          {isScratchDraft ? (
            <T>What should we work on?</T>
          ) : canChooseProject ? (
            <T>
              <Var>{projectSelector}</Var> to start
            </T>
          ) : (
            <T>Add a project to start</T>
          )}
        </h1>
      )}
      {scratchWorkspaceRoot === null ? null : (
        <p className="mt-2 flex h-6 w-full items-center justify-center text-sm">
          {isScratchDraft ? projectSelector : orStartWithoutProject}
        </p>
      )}
    </div>
  );
}
