import { Tabs } from "expo-router";
import { View, Text, Platform } from "react-native";

/** Simple inline SVG-like icons using React Native primitives. */
function Icon({ name, color, size }: { name: "dashboard" | "compliance" | "bell"; color: string; size: number }) {
  switch (name) {
    case "dashboard":
      return (
        <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
          {/* Grid icon — 4 squares */}
          <View style={{ flexDirection: "row", gap: 2 }}>
            <View style={{ width: size * 0.4, height: size * 0.4, borderRadius: 2, backgroundColor: color }} />
            <View style={{ width: size * 0.4, height: size * 0.4, borderRadius: 2, backgroundColor: color }} />
          </View>
          <View style={{ flexDirection: "row", gap: 2, marginTop: 2 }}>
            <View style={{ width: size * 0.4, height: size * 0.4, borderRadius: 2, backgroundColor: color }} />
            <View style={{ width: size * 0.4, height: size * 0.4, borderRadius: 2, backgroundColor: color }} />
          </View>
        </View>
      );
    case "compliance":
      return (
        <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
          {/* Checklist icon — 3 lines with check marks */}
          <View style={{ gap: 3 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <View style={{ width: size * 0.35, height: 2, backgroundColor: color, borderRadius: 1 }} />
              <View style={{ width: size * 0.3, height: 2, backgroundColor: color, borderRadius: 1 }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <View style={{ width: size * 0.35, height: 2, backgroundColor: color, borderRadius: 1 }} />
              <View style={{ width: size * 0.2, height: 2, backgroundColor: color, borderRadius: 1 }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <View style={{ width: size * 0.35, height: 2, backgroundColor: color, borderRadius: 1 }} />
              <View style={{ width: size * 0.35, height: 2, backgroundColor: color, borderRadius: 1 }} />
            </View>
          </View>
        </View>
      );
    case "bell":
      return (
        <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
          {/* Bell shape using circles and rounded rects */}
          <View style={{ width: size * 0.5, height: size * 0.45, backgroundColor: color, borderRadius: size * 0.25 }} />
          <View style={{ width: size * 0.15, height: size * 0.1, backgroundColor: color, borderRadius: 2, marginTop: 1 }} />
        </View>
      );
  }
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#2563EB" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
        tabBarActiveTintColor: "#2563EB",
        tabBarInactiveTintColor: "#9CA3AF",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarLabel: "Dashboard",
          tabBarIcon: ({ color, size }) => <Icon name="dashboard" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="compliance"
        options={{
          title: "Compliance",
          tabBarLabel: "Compliance",
          tabBarIcon: ({ color, size }) => <Icon name="compliance" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notifications",
          tabBarLabel: "Alerts",
          tabBarIcon: ({ color, size }) => <Icon name="bell" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}