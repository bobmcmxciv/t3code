import { requireOptionalNativeModule } from "expo";
import Constants from "expo-constants";

type ObserveApi = typeof import("expo-observe").Observe;

const relayUrl: unknown = Constants.expoConfig?.extra?.relay?.url;
const easProjectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;
const appVariant: unknown = Constants.expoConfig?.extra?.appVariant;

function checkNativeObserveModule(): boolean {
  try {
    return requireOptionalNativeModule("ExpoObserve") !== null;
  } catch {
    return false;
  }
}

const hasNativeObserveModule = checkNativeObserveModule();

// Crash reporting requires the native ExpoObserve module, an EAS project ID, and a relay URL.
// Self-hosted builds omit the upstream EAS project ID and exclude expo-observe from autolinking
// so Android's ObservabilityManager never throws on startup.
export const crashReportingAvailable =
  hasNativeObserveModule &&
  typeof relayUrl === "string" &&
  relayUrl.trim() !== "" &&
  typeof easProjectId === "string" &&
  easProjectId.trim() !== "";

let observePromise: Promise<ObserveApi | null> | null = null;
let loadedObserve: ObserveApi | null = null;

function loadObserve(): Promise<ObserveApi | null> {
  if (!hasNativeObserveModule) {
    return Promise.resolve(null);
  }
  if (observePromise === null) {
    observePromise = import("expo-observe")
      .then((mod) => {
        loadedObserve = mod.Observe;
        return mod.Observe;
      })
      .catch((error: unknown) => {
        console.warn("[observe] could not load expo-observe", error);
        return null;
      });
  }
  return observePromise;
}

export function reportCrashError(error: unknown): void {
  if (!crashReportingAvailable) return;
  if (loadedObserve) {
    loadedObserve.reportError(error);
    return;
  }
  void loadObserve().then((observe) => {
    observe?.reportError(error);
  });
}

interface PromiseRejectionTracker {
  readonly enablePromiseRejectionTracker?: (options: {
    readonly allRejections: boolean;
    readonly onUnhandled: (id: number, rejection: unknown) => void;
  }) => void;
}

// React Native tracks unhandled rejections only in development, for LogBox; Observe has no hook.
const isDevRuntime = typeof __DEV__ !== "undefined" && __DEV__;
if (!isDevRuntime && crashReportingAvailable) {
  const hermes: PromiseRejectionTracker | undefined = Reflect.get(globalThis, "HermesInternal");
  hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, rejection) => reportCrashError(rejection),
  });
}

let latestConfiguration = 0;

// While sending is off, a dispatch pass drops what it finds, so one runs before turning it back on.
// Best effort: Observe skips the pass while it is backing off from a failed send.
export async function setCrashReportsEnabled(enabled: boolean) {
  const configuration = ++latestConfiguration;
  const observe = await loadObserve();
  if (!observe || configuration !== latestConfiguration) return;
  const dispatchingEnabled = crashReportingAvailable && enabled;
  if (dispatchingEnabled) {
    await observe.dispatchEvents();
    if (configuration !== latestConfiguration) return;
  }
  observe.configure({
    dispatchingEnabled,
    ...(typeof appVariant === "string" ? { environment: appVariant } : {}),
  });
}

if (!crashReportingAvailable) {
  if (hasNativeObserveModule) {
    void setCrashReportsEnabled(false);
  }
} else {
  // Observe keeps its last configuration across launches; configuring it off while the setting
  // loads would drop the last session's native crash. Imported lazily so the persistence graph
  // never runs ahead of the imports `index.ts` orders first.
  const changedSinceLoad = () => latestConfiguration !== 0;
  void import("../../persistence/imperative")
    .then(({ loadPreferences }) => loadPreferences())
    .then(
      (preferences) =>
        changedSinceLoad()
          ? undefined
          : setCrashReportsEnabled(preferences.crashReportsEnabled !== false),
      // Observe keeps the last choice it was given, which stands in for the unreadable one.
      (error: unknown) => console.warn("[observe] could not read the crash report setting", error),
    )
    .catch((error: unknown) => {
      console.warn("[observe] could not apply the crash report setting", error);
    });
}
