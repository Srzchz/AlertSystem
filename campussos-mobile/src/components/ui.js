import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';

export function Button({ title, onPress, busy, disabled, variant = 'primary', icon, style }) {
  const bg = variant === 'danger' ? colors.alert : variant === 'gold' ? colors.gold : variant === 'outline' ? '#fff' : colors.green;
  const fg = variant === 'gold' ? colors.ink : variant === 'outline' ? colors.green : '#fff';
  return (
    <TouchableOpacity
      activeOpacity={0.85} onPress={onPress} disabled={busy || disabled} accessibilityRole="button"
      style={[ui.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, variant === 'outline' && ui.btnOutline, variant === 'danger' && ui.btnDanger, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : (
        <>
          {!!icon && <Ionicons name={icon} size={20} color={fg} style={{ marginRight: 8 }} />}
          <Text style={[ui.btnText, { color: fg }]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function Input({ icon, secure, multiline, style, ...rest }) {
  const [focus, setFocus] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <View style={[ui.field, focus && ui.fieldFocus, multiline && { alignItems: 'flex-start', minHeight: 92 }, style]}>
      {!!icon && <Ionicons name={icon} size={20} color={focus ? colors.green : colors.muted} style={multiline && { marginTop: 2 }} />}
      <TextInput
        {...rest} multiline={multiline} secureTextEntry={secure && !show}
        placeholderTextColor="#8A998D" style={[ui.input, multiline && { textAlignVertical: 'top', minHeight: 70 }]}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      />
      {secure && (
        <TouchableOpacity onPress={() => setShow(!show)} hitSlop={10} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export function SectionLabel({ children, hint }) {
  return (
    <View style={{ marginTop: 22, marginBottom: 10 }}>
      <Text style={ui.section}>{children}</Text>
      {!!hint && <Text style={ui.hint}>{hint}</Text>}
    </View>
  );
}

export function Chip({ label, selected, onPress, critical }) {
  const on = selected;
  const bg = on ? (critical ? colors.alert : colors.green) : '#fff';
  const border = on ? bg : critical ? '#F0B8BE' : colors.line;
  return (
    <TouchableOpacity
      onPress={onPress} activeOpacity={0.8} accessibilityRole="radio" accessibilityState={{ selected: !!on }}
      style={[ui.chip, { backgroundColor: bg, borderColor: border }]}
    >
      {on && <Ionicons name="checkmark" size={16} color="#fff" style={{ marginRight: 4 }} />}
      <Text style={[ui.chipText, { color: on ? '#fff' : critical ? colors.alertDark : colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const ui = StyleSheet.create({
  btn: { minHeight: 56, borderRadius: radius.md, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  btnOutline: { borderWidth: 1.5, borderColor: colors.green },
  btnDanger: { shadowColor: colors.alert, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  btnText: { fontSize: 17, fontWeight: '700' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 54, marginBottom: 12 },
  fieldFocus: { borderColor: colors.green, ...shadow, shadowOpacity: 0.08 },
  input: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 12, ...Platform.select({ web: { outlineStyle: 'none' } }) },
  section: { fontSize: 13, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.green },
  hint: { fontSize: 13, color: colors.muted, marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 44, borderRadius: 22, borderWidth: 1.5 },
  chipText: { fontSize: 15, fontWeight: '600' },
});
