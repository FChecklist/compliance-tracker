import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useRouter } from "expo-router";

type Stats = { total: number; overdue: number; due_today: number; completed: number };

export default function MobileDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({ total: 0, overdue: 0, due_today: 0, completed: 0 });
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/compliance/stats`, { credentials: "include" });
      const data = await res.json();
      if (data.stats) setStats(data.stats);
    } catch {}
  }

  useEffect(() => { load(); }, []);

  const cards = [
    { label: "Total", value: stats.total, color: "#EFF6FF", text: "#1D4ED8" },
    { label: "Overdue", value: stats.overdue, color: "#FEF2F2", text: "#DC2626" },
    { label: "Due Today", value: stats.due_today, color: "#FFFBEB", text: "#D97706" },
    { label: "Done", value: stats.completed, color: "#F0FDF4", text: "#16A34A" },
  ];

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async()=>{setRefreshing(true);await load();setRefreshing(false);}} />}>
      <Text style={s.title}>Dashboard</Text>
      <View style={s.grid}>
        {cards.map(c => (
          <View key={c.label} style={[s.card, { backgroundColor: c.color }]}>
            <Text style={[s.cardValue, { color: c.text }]}>{c.value}</Text>
            <Text style={[s.cardLabel, { color: c.text }]}>{c.label}</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity style={s.btn} onPress={() => router.push("/compliance")}>
        <Text style={s.btnText}>View All Compliance →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB", padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: "#111827", marginBottom: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 },
  card: { width: "47%", borderRadius: 12, padding: 16 },
  cardValue: { fontSize: 28, fontWeight: "bold" },
  cardLabel: { fontSize: 13, marginTop: 4 },
  btn: { backgroundColor: "#2563EB", borderRadius: 10, padding: 14, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});