import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../AuthContext';
import { colors } from '../theme';

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  return (
    <View style={s.wrap}>
      <Text style={s.hello}>Hi, {user.name.split(' ')[0]}. Who needs help?</Text>
      <TouchableOpacity style={[s.big, { backgroundColor: colors.alert }]} onPress={() => navigation.navigate('SosForm', { forSelf: true })} accessibilityRole="button">
        <Text style={s.bigText}>SOS: I need help</Text>
        <Text style={s.bigSub}>I am the patient</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.big, { backgroundColor: colors.amber }]} onPress={() => navigation.navigate('SosForm', { forSelf: false })} accessibilityRole="button">
        <Text style={s.bigText}>SOS: Someone else needs help</Text>
        <Text style={s.bigSub}>I am reporting for another person</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.row} onPress={() => navigation.navigate('Log')}><Text style={s.rowText}>My incident log</Text></TouchableOpacity>
      <TouchableOpacity style={s.row} onPress={logout}><Text style={[s.rowText, { color: colors.muted }]}>Log out</Text></TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 20, backgroundColor: colors.paper },
  hello: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 18 },
  big: { padding: 24, borderRadius: 12, marginBottom: 14 },
  bigText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  bigSub: { color: '#fff', opacity: 0.9, marginTop: 4 },
  row: { padding: 16, backgroundColor: colors.panel, borderRadius: 8, borderWidth: 1, borderColor: colors.line, marginBottom: 10 },
  rowText: { fontSize: 16, color: colors.ink },
});
