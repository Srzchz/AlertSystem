import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import { INFIRMARY_NUMBER } from '../config';
import { CATEGORIES, PATIENT_STATUSES, SEXES } from '../data/options';
import { colors } from '../theme';

function Field({ label, children }) {
  return <View style={{ marginBottom: 14 }}><Text style={s.label}>{label}</Text>{children}</View>;
}
function Dropdown({ value, onChange, items }) {
  return (
    <View style={s.pickerBox}>
      <Picker selectedValue={value} onValueChange={onChange}>
        {items.map((i) => <Picker.Item key={i.value} label={i.label} value={i.value} />)}
      </Picker>
    </View>
  );
}

export default function SosFormScreen({ route, navigation }) {
  const forSelf = route.params.forSelf;
  const { token } = useAuth();
  const [category, setCategory] = useState('MEDICAL_EMERGENCY');
  const [patientStatus, setPatientStatus] = useState('CONSCIOUS_BREATHING');
  const [sex, setSex] = useState('UNKNOWN');
  const [age, setAge] = useState('');
  const [nature, setNature] = useState('');
  const [place, setPlace] = useState('');
  const [coords, setCoords] = useState(null);
  const [locMsg, setLocMsg] = useState('Finding your location...');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setLocMsg('Location is off. Describe where you are below.');
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLocMsg('Location found');
      } catch {
        setLocMsg('Could not get GPS. Describe where you are below.');
      }
    })();
  }, []);

  async function send() {
    if (!coords && !place.trim()) return Alert.alert('Add a location', 'Turn on location or describe where you are.');
    setBusy(true);
    const patient = { sex, age: Number(age) || undefined };
    const net = await NetInfo.fetch();
    const online = net.isConnected && net.isInternetReachable !== false;
    try {
      if (!online) throw Object.assign(new Error('offline'), { offline: true });
      if (!coords) throw new Error('GPS is needed to send online. Move outside or use SMS.');
      const incident = await api('/incidents', {
        method: 'POST', token,
        body: { forSelf, patient, nature, category, patientStatus, location: { ...coords, description: place } },
      });
      navigation.replace('Tips', { category, incidentId: incident._id, via: 'app' });
    } catch (e) {
      if (!e.offline) { setBusy(false); return Alert.alert('Could not send alert', e.message); }
      // Offline fallback: pre-filled SMS to the infirmary
      const body = ['SOS', category, patientStatus, sex, age || '', coords ? `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}` : '', place || nature].join('|');
      if (!(await SMS.isAvailableAsync())) { setBusy(false); return Alert.alert('No connection', `Call the infirmary at ${INFIRMARY_NUMBER}.`); }
      await SMS.sendSMSAsync([INFIRMARY_NUMBER], body);
      navigation.replace('Tips', { category, via: 'sms' });
    }
  }

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.head}>{forSelf ? 'You are the patient' : 'You are reporting for someone else'}</Text>
      <Field label="Alert category"><Dropdown value={category} onChange={setCategory} items={CATEGORIES} /></Field>
      <Field label="Patient status"><Dropdown value={patientStatus} onChange={setPatientStatus} items={PATIENT_STATUSES} /></Field>
      <Field label="Patient sex"><Dropdown value={sex} onChange={setSex} items={SEXES} /></Field>
      <Field label="Patient age"><TextInput style={s.input} keyboardType="number-pad" value={age} onChangeText={setAge} placeholder="e.g. 19" maxLength={3} /></Field>
      <Field label="Nature of the accident or problem"><TextInput style={[s.input, { height: 80 }]} multiline value={nature} onChangeText={setNature} placeholder="e.g. Fell from the stairs, hit head" /></Field>
      <Field label={`Where are you? (${locMsg})`}><TextInput style={s.input} value={place} onChangeText={setPlace} placeholder="e.g. Gym entrance, 2nd floor hallway" /></Field>
      <TouchableOpacity style={s.send} onPress={send} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.sendText}>Send SOS</Text>}
      </TouchableOpacity>
      <Text style={s.hint}>No internet? The app will open a text message to the infirmary instead.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, backgroundColor: colors.paper },
  head: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 16 },
  label: { color: colors.muted, marginBottom: 4 },
  input: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, fontSize: 16, textAlignVertical: 'top' },
  pickerBox: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 8 },
  send: { backgroundColor: colors.alert, padding: 18, borderRadius: 10, alignItems: 'center', marginTop: 6 },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  hint: { color: colors.muted, textAlign: 'center', marginTop: 12 },
});
