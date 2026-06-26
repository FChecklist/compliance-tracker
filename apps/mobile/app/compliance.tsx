import { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";

type Item = { id: string; title: string; compliance_type: string; status: string; priority: string; due_date: string };

const STATUS_COLOR: Record<string,string> = { pending:"#FEF3C7", in_progress:"#DBEAFE", completed:"#D1FAE5", overdue:"#FEE2E2" };
const STATUS_TEXT: Record<string,string> = { pending:"#92400E", in_progress:"#1E40AF", completed:"#065F46", overdue:"#991B1B" };

export default function MobileComplianceScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/compliance`, { credentials: "include" })
      .then(r=>r.json()).then(d=>setItems(d.compliance??[])).finally(()=>setLoading(false));
  }, []);

  if (loading) return <View style={s.center}><ActivityIndicator color="#2563EB" /></View>;

  return (
    <View style={s.container}>
      <Text style={s.title}>Compliance</Text>
      <FlatList data={items} keyExtractor={i=>i.id}
        renderItem={({item}) => (
          <TouchableOpacity style={s.row} onPress={()=>router.push(`/compliance/${item.id}`)}>
            <View style={s.rowMain}>
              <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={s.rowType}>{item.compliance_type.toUpperCase()}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: STATUS_COLOR[item.status]??"#F3F4F6" }]}>
              <Text style={[s.badgeText, { color: STATUS_TEXT[item.status]??"#374151" }]}>{item.status}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={s.empty}>No compliance records yet</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB", padding: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "bold", color: "#111827", marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  rowMain: { flex: 1, marginRight: 12 },
  rowTitle: { fontSize: 14, fontWeight: "600", color: "#111827" },
  rowType: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  empty: { textAlign: "center", color: "#9CA3AF", marginTop: 40 },
});