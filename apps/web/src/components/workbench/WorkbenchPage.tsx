import { resolveCompanionPortalUrl } from "@t3tools/shared/companionSubscriptions";
import { T, useGT } from "gt-react";
import { ExternalLinkIcon, LayoutGridIcon } from "lucide-react";
import { useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";

export function WorkbenchPage() {
  const gt = useGT();
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const portalUrl = resolveCompanionPortalUrl(
    typeof window !== "undefined" ? window.location.origin : null,
    (import.meta.env.VITE_COMPANION_ORIGIN as string | undefined) ?? null,
  );

  const handleReload = () => {
    setLoaded(false);
    setReloadNonce((n) => n + 1);
  };

  return (
    <AppRouteModal label={gt("工作台")}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b ps-5 pe-2">
          <div className="flex min-w-0 items-center gap-2">
            <LayoutGridIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h1 className="truncate text-sm font-medium text-foreground">
              <T>工作台</T>
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {portalUrl ? (
              <>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={gt("刷新工作台")}
                  onClick={handleReload}
                >
                  <RefreshIcon className="size-3.5" refreshing={!loaded} />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void ensureLocalApi().shell.openExternal(portalUrl)}
                >
                  <T>浏览器打开</T>
                  <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                </Button>
              </>
            ) : null}
            <AppRouteModalClose />
          </div>
        </header>

        {portalUrl ? (
          <div className="relative flex min-h-0 flex-1 flex-col bg-background">
            <iframe
              key={reloadNonce}
              src={portalUrl}
              title={gt("工作台")}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              onLoad={() => setLoaded(true)}
              allow="clipboard-read; clipboard-write; microphone"
              className="min-h-0 w-full flex-1 border-0 bg-background"
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-foreground">
              <T>未配置 Companion 工作台地址</T>
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              <T>请在构建时设置 VITE_COMPANION_ORIGIN 环境变量后重新构建桌面端。</T>
            </p>
          </div>
        )}
      </div>
    </AppRouteModal>
  );
}
