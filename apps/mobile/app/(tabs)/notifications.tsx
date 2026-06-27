import { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";

type Notif = { id: string; title: string; body: string; type: string; is_read: boolean; created_at: string; link_url?: string };

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
    fetch(`${api}/api/notifications`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setNotifs(d.data?.notifications ?? d.notifications ?? []);
        setLoading(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const handlePress = async (notif: Notif) => {
    // Mark as read
    const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
    fetch(`${api}/api/notifications/${notif.id}/read`, { method: "POST", credentials: "include" }).catch(() => {});

    // Navigate if link exists
    if (notif.link_url) {
      const slug = notif.link_url.replace("/compliance/", "");
      router.push(`/compliance/${slug}` as any);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <View style={s.container}>
      {loading ? (
        <View style={s.center}><ActivityIndicator color="#2563EB" /></View>
      ) : (
        <FlatList
          data={notifs}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[s.card, !item.is_read && s.unread]}
              onPress={() => handlePress(item)}
              activeOpacity={0.7}
            >
              <View style={s.header}>
                <Text style={[s.title, !item.is_read && s.bold]} numberOfLines={1}>{item.title}</Text>
                <Text style={s.time}>{timeAgo(item.created_at)}</Text>
              </View>
              <Text style={s.body} numberOfLines={2}>{item.body}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={s.empty}>No notifications</Text>}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  unread: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  title: { fontSize: 14, color: "#1F2937", flex: 1, marginRight: 8 },
  bold: { fontWeight: "700" },
  body: { fontSize: 13, color: "#6B7280", lineHeight: 18 },
  time: { fontSize: 11, color: "#9CA3AF" },
  empty: { textAlign: "center", color: "#9CA3AF", marginTop: 40, fontSize: 14 },
});