import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

type Compliance = {
  id: string; title: string; compliance_type: string; status: string; priority: string;
  due_date: string | null; description: string | null; assignee_id: string | null;
  department_id: string | null; created_at: string; updated_at: string;
};

const STATUS_COLOR: Record<string, string> = { pending: "#F59E0B", in_progress: "#3B82F6", completed: "#10B981", overdue: "#EF4444" };

export default function ComplianceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<Compliance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
    fetch(`${api}/api/compliance/${id}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { setItem(d.data ?? d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  const changeStatus = (newStatus: string) => {
    const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
    fetch(`${api}/api/compliance/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ new_status: newStatus }),
    }).then((r) => {
      if (r.ok) router.back();
      else Alert.alert("Error", "Failed to change status");
    });
  };

  if (loading) return <View style={s.center}><ActivityIndicator color="#2563EB" /></View>;
  if (!item) return <View style={s.center}><Text style={s.error}>Not found</Text></View>;

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={s.title}>{item.title}</Text>

      <View style={s.badgeRow}>
        <View style={[s.badge, { backgroundColor: STATUS_COLOR[item.status] ?? "#9CA3AF" }]}>
          <Text style={s.badgeText}>{item.status.replace(/_/g, " ")}</Text>
        </View>
        <View style={[s.badge, { backgroundColor: "#F3F4F6" }]}>
          <Text style={s.badgeTextDark}>{item.priority}</Text>
        </View>
        <View style={[s.badge, { backgroundColor: "#F3F4F6" }]}>
          <Text style={s.badgeTextDark}>{item.compliance_type}</Text>
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>Due Date</Text>
        <Text style={s.sectionValue}>{item.due_date ? new Date(item.due_date).toLocaleDateString("en-IN") : "Not set"}</Text>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>Description</Text>
        <Text style={s.sectionValue}>{item.description ?? "No description"}</Text>
      </View>

      {item.status !== "completed" && (
        <View style={s.actions}>
          <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={() => changeStatus("in_progress")}>
            <Text style={s.btnText}>Start Working</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btn, s.btnSuccess]} onPress={() => changeStatus("completed")}>
            <Text style={s.btnText}>Mark Complete</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  error: { color: "#EF4444", fontSize: 16 },
  title: { fontSize: 20, fontWeight: "700", color: "#111827", marginBottom: 12 },
  badgeRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  badgeTextDark: { color: "#374151", fontSize: 12, fontWeight: "600" },
  section: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  sectionLabel: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginBottom: 4 },
  sectionValue: { fontSize: 15, color: "#1F2937" },
  actions: { gap: 10, marginTop: 16 },
  btn: { borderRadius: 12, padding: 14, alignItems: "center" },
  btnPrimary: { backgroundColor: "#2563EB" },
  btnSuccess: { backgroundColor: "#10B981" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});