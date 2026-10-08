import { Redirect } from "expo-router";
import { isFamily, useSession } from "../src/session";

export default function Index() {
  const { user } = useSession();
  if (!user) return <Redirect href="/login" />;
  if (!user.phoneVerified) return <Redirect href="/verify" />;
  return <Redirect href={isFamily(user.role) ? "/(tabs)" : "/webonly"} />;
}
