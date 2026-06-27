import { Stack } from "expo-router";

export default function MobileLayout() {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: "#2563EB" }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "bold" } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="dashboard" options={{ title: "Dashboard" }} />
      <Stack.Screen name="compliance" options={{ title: "Compliance" }} />
    </Stack>
  );
}