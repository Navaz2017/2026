import { useLocalSearchParams } from "expo-router";
import { Wizard } from "../../src/wizard";
import { Screen } from "../../src/ui";

export default function Apply() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Screen><Wizard appId={id} /></Screen>;
}
