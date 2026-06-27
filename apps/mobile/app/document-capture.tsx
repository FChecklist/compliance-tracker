import { View, Text, TouchableOpacity, StyleSheet, Image, Alert } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";

export default function DocumentCaptureScreen() {
  const router = useRouter();
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Stub: In production, this would use expo-camera or expo-document-picker
  async function handleCapture() {
    Alert.alert(
      "Document Capture",
      "Camera and document picker will be available in production.\n\nThis is a stub screen for the mobile app.",
      [{ text: "OK" }]
    );
  }

  async function handlePick() {
    Alert.alert(
      "Document Picker",
      "File picker integration coming soon.\n\nSupported formats: PDF, JPG, PNG, DOCX",
      [{ text: "OK" }]
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Document Capture</Text>
      <Text style={styles.subheading}>
        Take a photo or pick a document to attach to a compliance item
      </Text>

      {capturedImage ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: capturedImage }} style={styles.preview} />
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => setCapturedImage(null)}
          >
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.placeholderContainer}>
          <Text style={styles.placeholderIcon}>&#128196;</Text>
          <Text style={styles.placeholderText}>No document selected</Text>
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={handleCapture} activeOpacity={0.8}>
          <Text style={styles.actionIcon}>&#128247;</Text>
          <Text style={styles.actionLabel}>Take Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handlePick} activeOpacity={0.8}>
          <Text style={styles.actionIcon}>&#128194;</Text>
          <Text style={styles.actionLabel}>Pick File</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.uploadButton, !capturedImage && styles.uploadDisabled]}
        disabled={!capturedImage || uploading}
        activeOpacity={0.8}
      >
        <Text style={styles.uploadText}>
          {uploading ? "Uploading..." : "Upload Document"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.supportedFormats}>
        Supported: PDF, JPG, PNG, DOCX (max 10MB)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB", padding: 20 },
  heading: { fontSize: 22, fontWeight: "700", color: "#111827" },
  subheading: { fontSize: 14, color: "#6B7280", marginTop: 2, marginBottom: 24 },
  previewContainer: {
    backgroundColor: "#FFF", borderRadius: 16, borderWidth: 2,
    borderColor: "#D1D5DB", overflow: "hidden", marginBottom: 24,
  },
  preview: { width: "100%", height: 200, resizeMode: "cover" },
  clearButton: {
    padding: 12, alignItems: "center", backgroundColor: "#FEF2F2",
  },
  clearText: { color: "#DC2626", fontSize: 14, fontWeight: "600" },
  placeholderContainer: {
    backgroundColor: "#FFF", borderRadius: 16, borderWidth: 2,
    borderColor: "#E5E7EB", borderStyle: "dashed", padding: 40,
    alignItems: "center", marginBottom: 24,
  },
  placeholderIcon: { fontSize: 48, marginBottom: 8 },
  placeholderText: { fontSize: 14, color: "#9CA3AF" },
  actions: { flexDirection: "row", gap: 12, marginBottom: 24 },
  actionButton: {
    flex: 1, backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1,
    borderColor: "#E5E7EB", padding: 20, alignItems: "center",
  },
  actionIcon: { fontSize: 28, marginBottom: 6 },
  actionLabel: { fontSize: 13, fontWeight: "600", color: "#374151" },
  uploadButton: {
    backgroundColor: "#2563EB", borderRadius: 12, paddingVertical: 14, alignItems: "center",
  },
  uploadDisabled: { opacity: 0.5 },
  uploadText: { color: "#FFF", fontSize: 15, fontWeight: "600" },
  supportedFormats: {
    textAlign: "center", fontSize: 12, color: "#9CA3AF", marginTop: 12,
  },
});