import { Redirect, Tabs } from "expo-router";
import { Text } from "react-native";
import { useT } from "../../src/i18n";
import { isFamily, useSession } from "../../src/session";
import { C } from "../../src/ui";

const icon = (g: string) => ({ color }: { color: import("react-native").ColorValue }) => <Text style={{ color, fontSize: 20 }} accessible={false}>{g}</Text>;

export default function TabsLayout() {
  const { t } = useT();
  const { user } = useSession();
  if (!user) return <Redirect href="/login" />;
  if (!user.phoneVerified) return <Redirect href="/verify" />;
  if (!isFamily(user.role)) return <Redirect href="/webonly" />;
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: C.navy }, headerTintColor: "#fff", tabBarActiveTintColor: C.navy, tabBarLabelStyle: { fontSize: 13 }, tabBarStyle: { minHeight: 58, paddingBottom: 6 } }}>
      <Tabs.Screen name="index" options={{ title: t("nav.browse"), tabBarIcon: icon("⌕") }} />
      <Tabs.Screen name="applications" options={{ title: t("nav.myApps"), tabBarIcon: icon("☰") }} />
      <Tabs.Screen name="notifications" options={{ title: t("nav.notifications"), tabBarIcon: icon("✉") }} />
      <Tabs.Screen name="account" options={{ title: t("m.account"), tabBarIcon: icon("☺") }} />
    </Tabs>
  );
}
