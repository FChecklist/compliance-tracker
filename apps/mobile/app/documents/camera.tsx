import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

/**
 * Document capture screen — lets users take a photo or pick a file
 * from the gallery / file system, then uploads it to /api/documents.
 */
export default function DocumentCameraScreen() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const api = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

  /** Request camera/gallery permissions, take a photo, upload */
  const handleCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Camera access is needed to capture documents.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      setPreview(result.assets[0].uri);
      await uploadImage(result.assets[0].base64!);
    }
  };

  /** Pick an image from the gallery, upload */
  const handleGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Gallery access is needed to select documents.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      setPreview(result.assets[0].uri);
      await uploadImage(result.assets[0].base64!);
    }
  };

  /** Pick any document (PDF, DOCX, etc.) via document picker */
  const handleDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;

    const file = result.assets[0];
    setUploading(true);
    try {
      const formData = new FormData();
      // @ts-expect-error — React Native FormData accepts uri/name/type
      formData.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/octet-stream",
      });

      const res = await fetch(`${api}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data" },
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        Alert.alert("Uploaded", `"${file.name}" uploaded successfully.`, [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        Alert.alert("Upload Failed", data.error?.message ?? "Unknown error");
      }
    } catch (err) {
      Alert.alert("Error", "Failed to upload document. Check your connection.");
    } finally {
      setUploading(false);
    }
  };

  /** Upload a base64-encoded image to /api/documents */
  const uploadImage = async (base64: string) => {
    setUploading(true);
    try {
      const res = await fetch(`${api}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_base64: base64,
          filename: `capture_${Date.now()}.jpg`,
          mime_type: "image/jpeg",
        }),
      });

      const data = await res.json();
      if (data.success) {
        Alert.alert("Uploaded", "Document photo uploaded successfully.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        Alert.alert("Upload Failed", data.error?.message ?? "Unknown error");
      }
    } catch {
      Alert.alert("Error", "Failed to upload. Check your connection.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={s.container}>
      <Text style={s.heading}>Capture Document</Text>
      <Text style={s.subtext}>
        Take a photo or pick a file to attach to a compliance item.
      </Text>

      {preview && <Image source={{ uri: preview }} style={s.preview} />}

      {uploading ? (
        <ActivityIndicator size="large" color="#2563EB" />
      ) : (
        <>
          <TouchableOpacity style={s.button} onPress={handleCamera} activeOpacity={0.7}>
            <Text style={s.buttonTextPrimary}>Take Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.button} onPress={handleGallery} activeOpacity={0.7}>
            <Text style={s.buttonTextPrimary}>Pick from Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.button, s.buttonSecondary]}
            onPress={handleDocument}
            activeOpacity={0.7}
          >
            <Text style={s.buttonTextSecondary}>Choose File (PDF, DOCX…)</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  heading: { fontSize: 20, fontWeight: "700", color: "#111827", marginBottom: 8 },
  subtext: { fontSize: 14, color: "#6B7280", textAlign: "center", marginBottom: 24 },
  preview: { width: 200, height: 200, borderRadius: 12, marginBottom: 24, backgroundColor: "#E5E7EB" },
  button: {
    backgroundColor: "#2563EB",
    borderRadius: 12,
    padding: 16,
    width: "100%",
    alignItems: "center",
    marginBottom: 12,
  },
  buttonSecondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB" },
  buttonTextPrimary: { color: "#fff", fontSize: 15, fontWeight: "600" },
  buttonTextSecondary: { color: "#2563EB", fontSize: 15, fontWeight: "600" },
});