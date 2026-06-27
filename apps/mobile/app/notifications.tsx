import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native";
import { useState, useEffect } from "react";
import { useRouter } from "expo-router";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
  }, []);

  async function fetchNotifications() {
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      setNotifications(data.notifications || data || []);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <Text style={{ color: "#9CA3AF" }}>Loading notifications...</Text>
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>&#128276;</Text>
          <Text style={styles.emptyText}>No notifications yet</Text>
          <Text style={styles.emptySub}>We&apos;ll notify you about deadlines and updates</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, !item.is_read && styles.unread]}
              onPress={() => markRead(item.id)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.dot, !item.is_read && styles.dotActive]} />
                <Text style={styles.cardTime}>{timeAgo(item.created_at)}</Text>
              </View>
              <Text style={[styles.cardTitle, !item.is_read && styles.cardTitleBold]}>
                {item.title}
              </Text>
              <Text style={styles.cardMessage} numberOfLines={2}>
                {item.message}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#374151" },
  emptySub: { fontSize: 13, color: "#9CA3AF", marginTop: 4 },
  card: {
    backgroundColor: "#FFF",
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#E5E7EB",
  },
  unread: {
    borderLeftColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D1D5DB", marginRight: 8 },
  dotActive: { backgroundColor: "#2563EB" },
  cardTime: { fontSize: 11, color: "#9CA3AF" },
  cardTitle: { fontSize: 14, fontWeight: "500", color: "#374151", marginBottom: 2 },
  cardTitleBold: { fontWeight: "700", color: "#1E40AF" },
  cardMessage: { fontSize: 12, color: "#6B7280", lineHeight: 18 },
});