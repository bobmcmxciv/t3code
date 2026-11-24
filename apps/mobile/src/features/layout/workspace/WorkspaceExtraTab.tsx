import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { CompanionPortalScreen } from "../../companion/CompanionPortalScreen";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";
import { WorkflowsScreen } from "../../workflows/WorkflowsScreen";

export function WorkspaceExtraTab(props: {
  tab: Extract<NavigationTab, "usage" | "workflows" | "companion">;
}) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {props.tab === "companion" ? (
        <CompanionPortalScreen />
      ) : props.tab === "workflows" ? (
        <WorkflowsScreen />
      ) : (
        <UsageRouteScreen workspace />
      )}
    </>
  );
}
