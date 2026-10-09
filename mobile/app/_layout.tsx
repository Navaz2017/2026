import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActivityIndicator, View } from "react-native";
import { LanguageProvider, useT } from "../src/i18n";
import { SessionProvider, useSession } from "../src/session";
import { C } from "../src/ui";
import { LiveToast } from "../src/LiveToast";

function Shell() {
  const { loading } = useSession();
  const { t } = useT();
  if (loading) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: C.bg }}><ActivityIndicator color={C.navy} size="large" /></View>;
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: C.navy }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "600" }, headerBackTitle: t("common.back") }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen name="forgot" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="webonly" options={{ title: t("common.appName") }} />
        <Stack.Screen name="verify" options={{ title: t("auth.verifyTitle"), headerBackVisible: false }} />
        <Stack.Screen name="school/[id]" options={{ title: t("nav.browse") }} />
        <Stack.Screen name="start/[programId]" options={{ title: t("fam.start") }} />
        <Stack.Screen name="apply/[id]" options={{ title: t("fam.apply") }} />
        <Stack.Screen name="application/[id]" options={{ title: t("nav.myApps") }} />
        <Stack.Screen name="children" options={{ title: t("nav.children") }} />
        <Stack.Screen name="documents" options={{ title: t("nav.myDocs") }} />
        <Stack.Screen name="password" options={{ title: t("sec.changeTitle") }} />
      </Stack>
      <LiveToast />
    </>
  );
}

export default function Root() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
