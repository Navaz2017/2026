import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useT } from "./i18n";
import { setLive, useStore } from "./realtime";
import { C } from "./ui";

// A banner at the top of the screen for 7 seconds; tap to open Notifications.
export function LiveToast() {
  const toast = useStore((s) => s.toast);
  const { t } = useT();
  const router = useRouter();
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setLive({ toast: null }), 7000); return () => clearTimeout(id); }, [toast]);
  if (!toast) return null;
  const text = t(`notif.${toast.type}`) === `notif.${toast.type}` ? toast.type : t(`notif.${toast.type}`);
  return (
    <SafeAreaView edges={["top"]} pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 50 }}>
      <Pressable testID="live-toast" accessibilityRole="alert" onPress={() => { setLive({ toast: null }); router.push("/notifications"); }}
        style={{ margin: 12, padding: 14, backgroundColor: C.navy, borderLeftWidth: 4, borderLeftColor: C.gold, borderRadius: 6, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, elevation: 6 }}>
        <Text style={{ color: "#fff", fontSize: 16, lineHeight: 22 }}>{text}</Text>
        <Text style={{ color: "#ffe08a", fontSize: 14, marginTop: 4 }}>{t("rt.view")} ›</Text>
      </Pressable>
    </SafeAreaView>
  );
}
