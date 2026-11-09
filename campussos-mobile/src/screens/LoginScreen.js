import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useAuth } from '../AuthContext';
import { colors } from '../theme';

export default function LoginScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm({ ...form, [k]: v });

  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(form.email.trim(), form.password);
      else await register({ ...form, email: form.email.trim() });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>CampusSOS</Text>
        <Text style={s.sub}>{mode === 'login' ? 'Log in to send an emergency alert' : 'Create your account'}</Text>
        {mode === 'register' && (
          <>
            <TextInput style={s.input} placeholder="Full name" value={form.name} onChangeText={set('name')} />
            <TextInput style={s.input} placeholder="Mobile number (so the infirmary can reach you)" keyboardType="phone-pad" value={form.phone} onChangeText={set('phone')} />
          </>
        )}
        <TextInput style={s.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={form.email} onChangeText={set('email')} />
        <TextInput style={s.input} placeholder="Password (8+ characters)" secureTextEntry value={form.password} onChangeText={set('password')} />
        {!!error && <Text style={s.error}>{error}</Text>}
        <TouchableOpacity style={s.btn} onPress={submit} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{mode === 'login' ? 'Log in' : 'Create account'}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          <Text style={s.link}>{mode === 'login' ? 'No account yet? Sign up' : 'Already have an account? Log in'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.paper },
  title: { fontSize: 32, fontWeight: '700', color: colors.ink },
  sub: { color: colors.muted, marginBottom: 20, marginTop: 4 },
  input: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 14, marginBottom: 12, fontSize: 16 },
  btn: { backgroundColor: colors.teal, padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { color: colors.teal, textAlign: 'center', marginTop: 18, fontSize: 15 },
  error: { color: colors.alert, marginBottom: 8 },
});
