import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../AuthContext';
import { Button, Input } from '../components/ui';
import { colors, radius } from '../theme';

const FEATURES = [
  ['flash', 'One tap alert to the infirmary'],
  ['location', 'Your live location is shared with responders'],
  ['chatbubble-ellipses', 'Works by SMS when there is no internet'],
];

function Brand({ wide }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={s.logo}><Ionicons name="shield-checkmark" size={40} color={colors.green} /></View>
      <Text style={s.title}>CampusSOS</Text>
      <Text style={s.tag}>Fast help from the campus infirmary</Text>
      <View style={s.goldBar} />
      {wide && (
        <View style={s.features}>
          {FEATURES.map(([icon, text]) => (
            <View key={text} style={s.feature}>
              <View style={s.featureIcon}><Ionicons name={icon} size={18} color={colors.green} /></View>
              <Text style={s.featureText}>{text}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function LoginScreen() {
  const { login, register } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm({ ...form, [k]: v });
  const isLogin = mode === 'login';

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (isLogin) await login(form.email.trim(), form.password);
      else await register({ ...form, email: form.email.trim() });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <View style={s.formInner}>
      <Text style={s.head}>{isLogin ? 'Welcome back' : 'Create your account'}</Text>
      <Text style={s.sub}>{isLogin ? 'Log in to send an emergency alert' : 'It takes less than a minute'}</Text>

      {!isLogin && (
        <>
          <Input icon="person-outline" placeholder="Full name" value={form.name} onChangeText={set('name')} />
          <Input icon="call-outline" placeholder="Mobile number" keyboardType="phone-pad" value={form.phone} onChangeText={set('phone')} />
          <Text style={s.helper}>The infirmary uses this to reach you during an emergency.</Text>
        </>
      )}
      <Input icon="mail-outline" placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={form.email} onChangeText={set('email')} returnKeyType="next" />
      <Input icon="lock-closed-outline" placeholder="Password (8+ characters)" secure value={form.password} onChangeText={set('password')} returnKeyType="go" onSubmitEditing={submit} />

      {!!error && (
        <View style={s.error}>
          <Ionicons name="alert-circle" size={18} color={colors.alertDark} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <Button title={isLogin ? 'Log in' : 'Create account'} onPress={submit} busy={busy} style={{ marginTop: 6 }} />
      <TouchableOpacity onPress={() => { setMode(isLogin ? 'register' : 'login'); setError(''); }} style={{ paddingVertical: 18 }}>
        <Text style={s.link}>{isLogin ? 'No account yet? ' : 'Already have an account? '}<Text style={s.linkBold}>{isLogin ? 'Sign up' : 'Log in'}</Text></Text>
      </TouchableOpacity>
    </View>
  );

  // Laptop / tablet landscape: brand panel on the left, form on the right
  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={s.side}><Brand wide /></View>
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paper }}>
          <ScrollView contentContainerStyle={s.center} keyboardShouldPersistTaps="handled">{fields}</ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // Phone: green header with a rounded form sheet
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.green }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={{ paddingTop: insets.top + 32, paddingBottom: 48 }}><Brand /></View>
        <View style={s.sheet}>{fields}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  side: { flex: 1, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', padding: 40 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  sheet: { flex: 1, alignItems: 'center', backgroundColor: colors.paper, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 24, paddingTop: 28 },
  formInner: { width: '100%', maxWidth: 440 },
  logo: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.35)' },
  title: { fontSize: 32, fontWeight: '800', color: '#fff', marginTop: 14 },
  tag: { color: 'rgba(255,255,255,0.85)', fontSize: 15, marginTop: 4, textAlign: 'center' },
  goldBar: { width: 48, height: 4, borderRadius: 2, backgroundColor: colors.gold, marginTop: 16 },
  features: { marginTop: 36, gap: 14, alignSelf: 'stretch', maxWidth: 360 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  featureText: { color: '#fff', fontSize: 15, flexShrink: 1 },
  head: { fontSize: 26, fontWeight: '800', color: colors.ink },
  sub: { color: colors.muted, marginTop: 4, marginBottom: 22, fontSize: 15 },
  helper: { color: colors.muted, fontSize: 13, marginTop: -4, marginBottom: 12, marginLeft: 4 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.alertSoft, borderRadius: radius.sm, padding: 12, marginBottom: 10 },
  errorText: { color: colors.alertDark, flex: 1, fontSize: 14 },
  link: { color: colors.muted, textAlign: 'center', fontSize: 15 },
  linkBold: { color: colors.green, fontWeight: '800' },
});
