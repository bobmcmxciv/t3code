import { describe, expect, it } from "vite-plus/test";
import { providerAuthReturnUrl } from "./providerAuthReturnUrl.ts";

describe("provider auth return destinations", () => {
  it.each(["t3code", "t3code-dev"])(
    "returns to %s Welcome and the selected settings instance",
    (scheme) => {
      expect(providerAuthReturnUrl(`${scheme}://app/welcome?code=secret#agents:machine-id`)).toBe(
        `${scheme}://app/welcome#agents:machine-id`,
      );
      expect(
        providerAuthReturnUrl(`${scheme}://app/settings/providers?instanceId=work&code=secret`),
      ).toBe(`${scheme}://app/settings/providers?instanceId=work`);
    },
  );
  it.each(["https://t3.bobmcmxciv.xin/settings", "https://vircs.t3.bobmcmxciv.xin/welcome"])(
    "returns to the self-hosted app at %s",
    (url) => expect(providerAuthReturnUrl(url)).toBe(url),
  );
  it.each([
    "t3code://attacker/welcome",
    "t3code://app/welcome/../evil",
    "https://attacker.example/welcome",
    "http://vircs.t3.bobmcmxciv.xin/welcome",
    "https://vircs.t3.bobmcmxciv.xin:8443/welcome",
    "https://a.b.t3.bobmcmxciv.xin/welcome",
    "https://evil-t3.bobmcmxciv.xin/welcome",
    "https://t3.bobmcmxciv.xin.attacker.example/welcome",
  ])("rejects %s", (url) => expect(providerAuthReturnUrl(url)).toBeUndefined());
});
