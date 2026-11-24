import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

function resolveCompanionPortalUrl(): string | null {
  const explicitUrl = process.env.EXPO_PUBLIC_COMPANION_PORTAL_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }
  const origin = process.env.EXPO_PUBLIC_COMPANION_ORIGIN?.trim().replace(/\/+$/, "");
  if (origin) {
    return `${origin}/_portal/`;
  }
  return null;
}

const COMPANION_PORTAL_URL = resolveCompanionPortalUrl();

type PortalTabKey = "projects" | "threads" | "usage" | "voice" | "fleet";

const QUICK_TABS: readonly { readonly key: PortalTabKey; readonly label: string }[] = [
  { key: "projects", label: "工作台" },
  { key: "threads", label: "跨机线程" },
  { key: "usage", label: "用量" },
  { key: "voice", label: "G14语音" },
  { key: "fleet", label: "机群/授权" },
];

export function CompanionPortalScreen() {
  const { themeAppearance } = useAppearancePreferences();
  const webViewRef = useRef<WebView<object>>(null);
  const selectDetail = useSelectWorkspaceDetail();
  const { savedConnectionsById } = useSavedRemoteConnections();

  const [activeTab, setActiveTab] = useState<PortalTabKey>("projects");
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const isDark = themeAppearance === "dark";

  // Map portal env slug (e.g. host-a, host-b) or native t3EnvId to the paired native EnvironmentId
  const resolveNativeEnvironmentId = (envSlug: string, t3EnvId?: string): EnvironmentId | null => {
    const direct = (t3EnvId || "").trim();
    const slug = envSlug.trim().toLowerCase();
    for (const conn of Object.values(savedConnectionsById)) {
      if (direct && String(conn.environmentId) === direct) {
        return conn.environmentId;
      }
      const host = (conn.httpBaseUrl || conn.displayUrl || "").toLowerCase();
      if (host.includes(`://${slug}.t3.`) || conn.environmentLabel.toLowerCase().includes(slug)) {
        return conn.environmentId;
      }
    }
    return null;
  };

  const switchPortalTab = (tab: PortalTabKey) => {
    setActiveTab(tab);
    webViewRef.current?.injectJavaScript(`
      (function(){
        try {
          if (typeof showTab === 'function') { showTab('${tab}'); }
        } catch(e) {}
      })();
      true;
    `);
  };

  const injectedMobileBridgeJs = `
    (function() {
      try {
        document.documentElement.classList.toggle('dark', ${isDark ? "true" : "false"});
        // Intercept Portal's openThread(envId, t3EnvId, threadId) so tapping a thread opens native Mobile Thread screen
        if (!window.__t3MobileBridged) {
          window.__t3MobileBridged = true;
          var origOpenThread = window.openThread;
          if (typeof origOpenThread === 'function') {
            window.openThread = function(envId, t3EnvId, threadId) {
              if (window.ReactNativeWebView && threadId) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'openThread',
                  envId: String(envId || ''),
                  t3EnvId: String(t3EnvId || ''),
                  threadId: String(threadId || '')
                }));
                return Promise.resolve();
              }
              return origOpenThread.apply(this, arguments);
            };
          }
          // Sync native quick-tab pill when user taps inside Portal sidebar
          var origShowTab = window.showTab;
          if (typeof origShowTab === 'function') {
            window.showTab = function(name) {
              if (window.ReactNativeWebView && name) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tabChanged', tab: String(name) }));
              }
              return origShowTab.apply(this, arguments);
            };
          }
        }
        // Compact mobile styling inside native tab: hide duplicate web topbar & tighten top spacing
        if (!document.getElementById('t3-native-mobile-style')) {
          var st = document.createElement('style');
          st.id = 't3-native-mobile-style';
          st.textContent = 'body { -webkit-tap-highlight-color: transparent; } header.topbar { display: none !important; } .viewport { padding-top: 8px !important; } .container { padding-top: 4px !important; }';
          document.head.appendChild(st);
        }
      } catch (e) {}
    })();
    true;
  `;

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg?.type === "tabChanged" && typeof msg.tab === "string") {
        const valid: readonly string[] = ["projects", "threads", "usage", "voice", "fleet"];
        if (valid.includes(msg.tab)) {
          setActiveTab(msg.tab as PortalTabKey);
        }
      } else if (msg?.type === "openThread" && msg.threadId) {
        const nativeEnvId = resolveNativeEnvironmentId(
          String(msg.envId || ""),
          String(msg.t3EnvId || ""),
        );
        if (nativeEnvId) {
          selectDetail({
            name: "Thread",
            params: {
              environmentId: nativeEnvId,
              threadId: ThreadId.make(String(msg.threadId)),
            },
          });
        }
      }
    } catch {}
  };

  const portalUrl = COMPANION_PORTAL_URL;

  if (!portalUrl) {
    return (
      <View className="flex-1 bg-screen">
        <AppBar title="工作台" hideBottomBorder />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-sm font-t3-medium text-foreground">
            未配置 Companion 工作台地址
          </Text>
          <Text className="mt-2 text-center text-xs text-foreground-muted">
            请在构建时设置 EXPO_PUBLIC_COMPANION_ORIGIN 或 EXPO_PUBLIC_COMPANION_PORTAL_URL 环境变量。
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-screen">
      <AppBar title="工作台" hideBottomBorder />
      {/* Single-row compact quick-jump bar directly under native AppBar (zero double top inset) */}
      <View className="border-b border-border-subtle bg-header">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 6, alignItems: "center" }}
        >
          {QUICK_TABS.map((item) => {
            const selected = activeTab === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => switchPortalTab(item.key)}
                className={
                  selected
                    ? "rounded-full bg-primary px-2.5 py-1"
                    : "rounded-full bg-grouped-card px-2.5 py-1 active:opacity-70"
                }
              >
                <Text
                  className={
                    selected
                      ? "text-xs font-t3-semibold text-primary-foreground"
                      : "text-xs font-t3-medium text-foreground-muted"
                  }
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="刷新工作台"
            onPress={() => {
              setErrorText(null);
              webViewRef.current?.reload();
            }}
            className="rounded-full bg-grouped-card px-2.5 py-1 active:opacity-70"
          >
            <Text className="text-xs font-t3-medium text-foreground-muted">刷新</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="在浏览器打开"
            onPress={() => void tryOpenExternalUrl(portalUrl)}
            className="rounded-full bg-grouped-card px-2.5 py-1 active:opacity-70"
          >
            <Text className="text-xs font-t3-medium text-foreground-muted">外链 ↗</Text>
          </Pressable>
        </ScrollView>
      </View>

      <View className="relative flex-1">
        <WebView<object>
          ref={webViewRef}
          source={{ uri: portalUrl }}
          style={{ flex: 1, backgroundColor: "transparent" }}
          injectedJavaScript={injectedMobileBridgeJs}
          onMessage={handleMessage}
          onLoadStart={() => {
            setLoading(true);
            setErrorText(null);
          }}
          onLoadEnd={() => {
            setLoading(false);
            webViewRef.current?.injectJavaScript(injectedMobileBridgeJs);
          }}
          onError={(syntheticEvent) => {
            setLoading(false);
            setErrorText(syntheticEvent.nativeEvent.description || "无法连接工作台");
          }}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          pullToRefreshEnabled={Platform.OS === "ios"}
        />
        {loading ? (
          <View
            pointerEvents="none"
            className="absolute inset-x-0 top-3 items-center"
          >
            <View className="flex-row items-center gap-2 rounded-full border border-border-subtle bg-grouped-card px-3 py-1.5">
              <AppActivityIndicator size="small" colorClassName="accent-primary" />
              <Text className="text-xs text-foreground-muted">正在加载工作台…</Text>
            </View>
          </View>
        ) : null}
        {errorText ? (
          <View className="absolute inset-0 items-center justify-center bg-screen px-6">
            <Text className="text-center text-sm font-t3-medium text-danger-foreground">
              {errorText}
            </Text>
            <Pressable
              onPress={() => {
                setErrorText(null);
                webViewRef.current?.reload();
              }}
              className="mt-3 rounded-xl bg-primary px-4 py-2"
            >
              <Text className="text-sm font-t3-medium text-primary-foreground">重试连接</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
