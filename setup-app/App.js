import { useEffect, useState } from "react";
import { AppState, Linking, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { auth, dashboardUrl } from "./src/account";
import Setup from "./src/setup";
import { Action, styles } from "./src/ui";

function Account() {
  const [session,setSession] = useState(undefined);
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");

  useEffect(() => {
    if (!auth) return;
    const {data:{subscription}} = auth.onAuthStateChange((_event,current) => setSession(current));
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") auth.startAutoRefresh();
      else auth.stopAutoRefresh();
    });
    if (AppState.currentState === "active") auth.startAutoRefresh();
    return () => {
      subscription.unsubscribe();
      listener.remove();
      auth.stopAutoRefresh();
    };
  },[]);

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const {error: failure} = await auth.signInWithPassword({email:email.trim(),password});
      if (failure) throw failure;
      setPassword("");
    } catch {
      setError("Could not sign in. Check your email, password and confirmation email.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setError("");
    try {
      const {error:failure} = await auth.signOut({scope:"local"});
      if (failure) throw failure;
    } catch {
      setError("Could not sign out. Try again.");
    }
  }

  if (!auth) return <Text style={styles.error}>This build is missing its account or Dashboard configuration.</Text>;
  if (session === undefined) return <Text style={styles.copy}>Opening your account…</Text>;
  if (session) {
    return <Setup key={session.user.id} email={session.user.email} signOut={signOut} accountError={error} />;
  }
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Sign in</Text>
    <Text style={styles.copy}>Use the same account as your DrySpool Dashboard.</Text>
    <Text style={styles.label}>Email</Text>
    <TextInput style={styles.input} accessibilityLabel="Email" autoCapitalize="none"
      autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
    <Text style={styles.label}>Password</Text>
    <TextInput style={styles.input} accessibilityLabel="Password" secureTextEntry
      autoComplete="current-password" value={password} onChangeText={setPassword} />
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Action disabled={busy || !email.trim() || !password} onPress={signIn}>{busy ? "Signing in…" : "Sign in"}</Action>
    <Action secondary onPress={() => Linking.openURL(dashboardUrl).catch(() => setError("Open the DrySpool website to create an account."))}>Create an account on Dashboard</Action>
  </View>;
}

export default function App() {
  return <SafeAreaProvider>
    <SafeAreaView style={styles.page}>
      <Text style={styles.brand}>DrySpool Setup</Text>
      <Account />
    </SafeAreaView>
  </SafeAreaProvider>;
}
