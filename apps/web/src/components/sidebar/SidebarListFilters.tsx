import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ChevronDownIcon, ServerIcon, XIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

const ALL_ENVIRONMENTS_VALUE = "__all__";

export interface SidebarEnvironmentFilterOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
}

/** A labelled filter pill; the trigger of a filter menu or combobox renders through it. */
export function SidebarFilterChip({
  active,
  className,
  children,
  ...rest
}: { active: boolean; children?: ReactNode } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-active={active ? "" : undefined}
      {...rest}
      className={cn(
        "group/filter-chip inline-flex h-6 min-w-0 max-w-full shrink items-center gap-1 rounded-full border border-sidebar-border/70 px-2 text-xs text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-active:border-primary/40 data-active:bg-primary/10 data-active:text-sidebar-foreground data-popup-open:bg-sidebar-row-hover",
        className,
      )}
    >
      {children}
      <ChevronDownIcon aria-hidden className="size-3 shrink-0 opacity-60" />
    </button>
  );
}

export function SidebarEnvironmentFilter(props: {
  readonly environments: ReadonlyArray<SidebarEnvironmentFilterOption>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly onChange: (environmentId: EnvironmentId | null) => void;
}) {
  const gt = useGT();
  const selected = props.environments.find(
    (environment) => environment.environmentId === props.selectedEnvironmentId,
  );
  return (
    <Menu>
      <MenuTrigger
        render={
          <SidebarFilterChip
            active={selected !== undefined}
            aria-label={gt("Filter threads by environment")}
          />
        }
      >
        <ServerIcon aria-hidden className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{selected?.label ?? gt("All environments")}</span>
      </MenuTrigger>
      <MenuPopup align="start" className="max-w-72">
        <MenuRadioGroup
          aria-label={gt("Filter threads by environment")}
          value={props.selectedEnvironmentId ?? ALL_ENVIRONMENTS_VALUE}
          onValueChange={(next: string) =>
            props.onChange(
              next === ALL_ENVIRONMENTS_VALUE
                ? null
                : (props.environments.find((environment) => environment.environmentId === next)
                    ?.environmentId ?? null),
            )
          }
        >
          <MenuRadioItem value={ALL_ENVIRONMENTS_VALUE} closeOnClick>
            <span className="flex min-w-0 items-center gap-3">
              <span className="min-w-0 flex-1 truncate">{gt("All environments")}</span>
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
          <MenuSeparator />
          {props.environments.map((environment) => (
            <MenuRadioItem
              key={environment.environmentId}
              value={environment.environmentId}
              closeOnClick
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    environment.connected ? "bg-success" : "bg-muted-foreground/40",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{environment.label}</span>
                {environment.connected ? null : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {gt("Offline", { $context: "environment connection state" })}
                  </span>
                )}
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** The thread list's environment and project filters, shown as pills under the search field. */
export function SidebarListFilters(props: {
  readonly environmentFilter: ReactNode;
  readonly projectFilter: ReactNode;
  readonly filtered: boolean;
  readonly onClear: () => void;
}) {
  const gt = useGT();
  if (props.environmentFilter === null && props.projectFilter === null) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1.5 px-1 pt-1.5"
      data-testid="sidebar-list-filters"
    >
      {props.environmentFilter}
      {props.projectFilter}
      {props.filtered ? (
        <button
          type="button"
          aria-label={gt("Clear thread filters")}
          onClick={props.onClear}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <XIcon aria-hidden className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
