import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";

const TYPES = ["statutory", "internal", "regulatory", "contractual"];
const PRIORITIES = ["critical", "high", "medium", "low"];

export default function ComplianceCreateScreen() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [typeIdx, setTypeIdx] = useState(0);
  const [prioIdx, setPrioIdx] = useState(2);
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return Alert.alert("Validation", "Title is required");
    setLoading(true);
    const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
    try {
      const res = await fetch(`${api}/api/compliance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: title.trim(),
          compliance_type: TYPES[typeIdx],
          priority: PRIORITIES[prioIdx],
          due_date: dueDate || undefined,
        }),
      });
      if (res.ok) {
        Alert.alert("Created", "Compliance item added");
        router.back();
      } else {
        const d = await res.json();
        Alert.alert("Error", d.error?.message ?? "Failed to create");
      }
    } catch {
      Alert.alert("Error", "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={s.label}>Title *</Text>
      <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="e.g. GST Filing Q2 2026" />

      <Text style={s.label}>Type</Text>
      <View style={s.row}>
        {TYPES.map((t, i) => (
          <TouchableOpacity key={t} style={[s.chip, i === typeIdx && s.chipActive]} onPress={() => setTypeIdx(i)}>
            <Text style={[s.chipText, i === typeIdx && s.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.label}>Priority</Text>
      <View style={s.row}>
        {PRIORITIES.map((p, i) => (
          <TouchableOpacity key={p} style={[s.chip, i === prioIdx && s.chipActive]} onPress={() => setPrioIdx(i)}>
            <Text style={[s.chipText, i === prioIdx && s.chipTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.label}>Due Date</Text>
      <TextInput style={s.input} value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" keyboardType="numeric" />

      <TouchableOpacity style={[s.button, loading && s.buttonDisabled]} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Create Compliance</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 16 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12, fontSize: 15 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#D1D5DB" },
  chipActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText: { fontSize: 13, color: "#4B5563" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  button: { backgroundColor: "#2563EB", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 28 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});