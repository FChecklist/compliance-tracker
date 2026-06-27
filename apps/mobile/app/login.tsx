import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";

export default function MobileLoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function login() {
    if (!email || !password) return;
    setLoading(true);
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error ?? "Login failed"); return; }
      router.replace("/dashboard");
    } catch { Alert.alert("Error", "Network error"); }
    finally { setLoading(false); }
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>ComplianceTrack</Text>
      <Text style={s.subtitle}>Sign in to your account</Text>
      <TextInput style={s.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <TouchableOpacity style={[s.btn, loading&&s.btnDisabled]} onPress={login} disabled={loading}>
        <Text style={s.btnText}>{loading?"Signing in...":"Sign in"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex:1, justifyContent:"center", padding:24, backgroundColor:"#F9FAFB" },
  title: { fontSize:28, fontWeight:"bold", color:"#2563EB", textAlign:"center", marginBottom:4 },
  subtitle: { fontSize:14, color:"#6B7280", textAlign:"center", marginBottom:32 },
  input: { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, padding:12, marginBottom:12, backgroundColor:"#fff", fontSize:14 },
  btn: { backgroundColor:"#2563EB", borderRadius:10, padding:14, alignItems:"center" },
  btnDisabled: { opacity:0.6 },
  btnText: { color:"#fff", fontWeight:"600", fontSize:15 },
});