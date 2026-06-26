import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

// TODO: Integrate expo-camera and expo-document-picker for real capture
// This is a placeholder stub as per spec

export default function DocumentCameraScreen() {
  const router = useRouter();

  const handleCamera = () => {
    // TODO: Launch expo-camera, capture image, upload to /api/documents
    console.log("TODO: Open camera");
  };

  const handleGallery = () => {
    // TODO: Launch expo-document-picker, select file, upload to /api/documents
    console.log("TODO: Open gallery picker");
  };

  return (
    <View style={s.container}>
      <Text style={s.heading}>Capture Document</Text>
      <Text style={s.subtext}>Take a photo or pick from your gallery to attach to a compliance item.</Text>

      <TouchableOpacity style={s.button} onPress={handleCamera} activeOpacity={0.7}>
        <Text style={s.buttonText}>Take Photo</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[s.button, s.buttonSecondary]} onPress={handleGallery} activeOpacity={0.7}>
        <Text style={s.buttonText}>Pick from Gallery</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB", justifyContent: "center", alignItems: "center", padding: 24 },
  heading: { fontSize: 20, fontWeight: "700", color: "#111827", marginBottom: 8 },
  subtext: { fontSize: 14, color: "#6B7280", textAlign: "center", marginBottom: 32 },
  button: { backgroundColor: "#2563EB", borderRadius: 12, padding: 16, width: "100%", alignItems: "center", marginBottom: 12 },
  buttonSecondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#D1D5DB" },
  buttonText: { color: "#2563EB", fontSize: 15, fontWeight: "600" },
});