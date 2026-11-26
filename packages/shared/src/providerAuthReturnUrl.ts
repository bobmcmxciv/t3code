import { isLoopbackHost } from "./preview.ts";

/** Self-hosted app origins: the ECS apex or one per-host label, HTTPS on the default port only. */
const SELF_HOSTED_APP_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?t3\.bobmcmxciv\.xin$/u;

export function providerAuthReturnUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const desktop = ["t3code:", "t3code-dev:"].includes(url.protocol) && url.host === "app";
    const web =
      (["http:", "https:"].includes(url.protocol) && isLoopbackHost(url.hostname)) ||
      (url.protocol === "https:" && url.port === "" && SELF_HOSTED_APP_HOST.test(url.hostname));
    if (
      url.username ||
      url.password ||
      (!desktop && !web) ||
      (url.pathname !== "/welcome" &&
        url.pathname !== "/settings" &&
        !url.pathname.startsWith("/settings/"))
    )
      return undefined;
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        url.pathname === "/welcome" ||
        !["machine", "project", "checkout", "environmentId", "instanceId"].includes(key)
      ) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== "/welcome" || !/^#agents:[\w-]+$/u.test(url.hash)) url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
