import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";

const COMPLIANCE_TYPES = [
  { label: "IT", value: "it" },
  { label: "Tax", value: "tax" },
  { label: "Legal", value: "legal" },
  { label: "Regulatory", value: "regulatory" },
  { label: "Operational", value: "operational" },
  { label: "Environmental", value: "environmental" },
  { label: "HR", value: "hr" },
  { label: "Finance", value: "finance" },
];

const PRIORITIES = [
  { label: "Critical", value: "critical", color: "#DC2626" },
  { label: "High", value: "high", color: "#EA580C" },
  { label: "Medium", value: "medium", color: "#D97706" },
  { label: "Low", value: "low", color: "#16A34A" },
];

export default function QuickAddScreen() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("other");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!title.trim()) {
      Alert.alert("Required", "Please enter a title.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          compliance_type: type,
          priority,
          due_date: dueDate || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        Alert.alert("Created", "Compliance item added successfully.", [
          { text: "Add Another", onPress: () => { setTitle(""); setDescription(""); } },
          { text: "Done", onPress: () => router.back() },
        ]);
      } else {
        Alert.alert("Error", data.error || "Failed to create.");
      }
    } catch (err) {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.heading}>Quick Add</Text>
      <Text style={styles.subheading}>Create a new compliance item</Text>

      <Text style={styles.label}>Title *</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. File GST Return" />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={description}
        onChangeText={setDescription}
        placeholder="Optional details..."
        multiline
        numberOfLines={3}
      />

      <Text style={styles.label}>Compliance Type</Text>
      <View style={styles.chipRow}>
        {COMPLIANCE_TYPES.map((ct) => (
          <TouchableOpacity
            key={ct.value}
            style={[styles.chip, type === ct.value && styles.chipActive]}
            onPress={() => setType(ct.value)}
          >
            <Text style={[styles.chipText, type === ct.value && styles.chipTextActive]}>
              {ct.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Priority</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[
              styles.chip,
              priority === p.value && { backgroundColor: p.color },
            ]}
            onPress={() => setPriority(p.value)}
          >
            <Text style={[styles.chipText, priority === p.value && { color: "#FFF" }]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Due Date (YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        value={dueDate}
        onChangeText={setDueDate}
        placeholder="2026-07-31"
        keyboardType="numeric"
      />

      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>{submitting ? "Creating..." : "Create Compliance Item"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  heading: { fontSize: 22, fontWeight: "700", color: "#111827" },
  subheading: { fontSize: 14, color: "#6B7280", marginTop: 2, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12,
    fontSize: 14, color: "#111827", backgroundColor: "#FFF",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB",
  },
  chipActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText: { fontSize: 12, color: "#6B7280", fontWeight: "500" },
  chipTextActive: { color: "#FFF" },
  button: {
    marginTop: 28, backgroundColor: "#2563EB", borderRadius: 12,
    paddingVertical: 14, alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#FFF", fontSize: 15, fontWeight: "600" },
});