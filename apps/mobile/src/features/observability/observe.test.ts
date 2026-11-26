import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockRequireOptionalNativeModule = vi.fn();
const mockObserveConfigure = vi.fn();
const mockObserveDispatchEvents = vi.fn();
const mockObserveReportError = vi.fn();

const mockExpoConfig: {
  extra?: {
    relay?: { url?: string | null };
    eas?: { projectId?: string };
    appVariant?: string;
  };
} = {};

vi.mock("expo", () => ({
  requireOptionalNativeModule: (...args: ReadonlyArray<unknown>) =>
    mockRequireOptionalNativeModule(...args),
}));

vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));

vi.mock("expo-observe", () => ({
  Observe: {
    configure: mockObserveConfigure,
    dispatchEvents: mockObserveDispatchEvents,
    reportError: mockObserveReportError,
  },
}));

vi.mock("../../persistence/imperative", () => ({
  loadPreferences: vi.fn(async () => ({ crashReportsEnabled: true })),
}));

beforeEach(() => {
  vi.resetModules();
  mockRequireOptionalNativeModule.mockReset();
  mockObserveConfigure.mockReset();
  mockObserveDispatchEvents.mockReset();
  mockObserveReportError.mockReset();
  mockExpoConfig.extra = undefined;
});

describe("mobile observability guard", () => {
  it("stays disabled and avoids expo-observe when native module or EAS projectId is absent", async () => {
    mockRequireOptionalNativeModule.mockReturnValue(null);
    mockExpoConfig.extra = {
      relay: { url: null },
      eas: {},
      appVariant: "preview",
    };

    const mod = await import("./observe");
    expect(mod.crashReportingAvailable).toBe(false);

    mod.reportCrashError(new Error("boom"));
    await mod.setCrashReportsEnabled(true);

    expect(mockObserveConfigure).not.toHaveBeenCalled();
    expect(mockObserveDispatchEvents).not.toHaveBeenCalled();
    expect(mockObserveReportError).not.toHaveBeenCalled();
  });

  it("stays disabled when native module exists but EAS projectId is omitted", async () => {
    mockRequireOptionalNativeModule.mockReturnValue({});
    mockExpoConfig.extra = {
      relay: { url: "https://relay.example.com" },
      eas: {},
      appVariant: "preview",
    };

    const mod = await import("./observe");
    expect(mod.crashReportingAvailable).toBe(false);

    mod.reportCrashError(new Error("boom"));
    expect(mockObserveReportError).not.toHaveBeenCalled();
  });

  it("enables crash reporting when native module, relay URL, and EAS projectId are configured", async () => {
    mockRequireOptionalNativeModule.mockReturnValue({});
    mockObserveDispatchEvents.mockResolvedValue(undefined);
    mockExpoConfig.extra = {
      relay: { url: "https://relay.example.com" },
      eas: { projectId: "11111111-2222-3333-4444-555555555555" },
      appVariant: "preview",
    };

    const mod = await import("./observe");
    expect(mod.crashReportingAvailable).toBe(true);

    await mod.setCrashReportsEnabled(true);
    expect(mockObserveDispatchEvents).toHaveBeenCalledTimes(1);
    expect(mockObserveConfigure).toHaveBeenCalledWith({
      dispatchingEnabled: true,
      environment: "preview",
    });

    const err = new Error("render failure");
    mod.reportCrashError(err);
    expect(mockObserveReportError).toHaveBeenCalledWith(err);
  });
});
