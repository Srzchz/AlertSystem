import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { useDevice } from '../DeviceContext';
import { api, isDeliveryFailure } from '../api';
import { openSmsFallback } from '../sms';
import { CATEGORIES, CATEGORY_ICONS, CRITICAL_STATUSES, PATIENT_STATUSES, SEXES } from '../data/options';
import { Button, Chip, Input, SectionLabel } from '../components/ui';
import { colors, radius } from '../theme';

export default function SosFormScreen({ route, navigation }) {
  const forSelf = route.params.forSelf;
  const { getDeviceId } = useDevice();
  const insets = useSafeAreaInsets();
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

  // Opens the pre-filled SMS to the infirmary and moves to Tips if it opened.
  async function sendBySms(details) {
    setBusy(true);
    let opened = false;
    try {
      opened = await openSmsFallback(details);
    } catch (e) {
      Alert.alert('Could not open SMS', e.message);
    }
    if (!opened) { setBusy(false); return; }
    navigation.replace('Tips', { category: details.category, via: 'sms' });
  }

  async function send() {
    if (!coords && !place.trim()) return Alert.alert('Add a location', 'Turn on location or describe where you are.');
    setBusy(true);
    const details = { category, patientStatus, sex, age, coords, place, nature };
    let online = false;
    try {
      const net = await NetInfo.fetch();
      online = !!net.isConnected && net.isInternetReachable !== false;
    } catch {
      online = false;
    }

    // Offline: keep the SMS fallback and send no request.
    if (!online) return sendBySms(details);

    if (!coords) {
      setBusy(false);
      return Alert.alert('Could not send alert', 'GPS is needed to send online. Move outside or use SMS.');
    }

    const patient = { sex, age: Number(age) || undefined };
    try {
      const deviceId = await getDeviceId();
      const incident = await api('/incidents', {
        method: 'POST',
        timeoutMs: 10000,
        body: { deviceId, forSelf, patient, nature, category, patientStatus, location: { ...coords, description: place } },
      });
      navigation.replace('Tips', { category, incidentId: incident._id, deviceId, via: 'app' });
    } catch (e) {
      setBusy(false);
      if (isDeliveryFailure(e)) {
        // Form state is untouched, so "Try again" just dismisses and the user can resend.
        return Alert.alert('Alert not delivered', 'Your alert did not reach the infirmary.', [
          { text: 'Try again' },
          { text: 'Send by SMS', onPress: () => sendBySms(details) },
        ]);
      }
      Alert.alert('Could not send alert', e.message);
    }
  }

  const locState = coords ? 'ok' : locMsg.startsWith('Finding') ? 'wait' : 'off';

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={s.who}>
          <Ionicons name={forSelf ? 'person' : 'people'} size={18} color={colors.goldInk} />
          <Text style={s.whoText}>{forSelf ? 'You are the patient' : 'You are reporting for someone else'}</Text>
        </View>

        <SectionLabel hint="Pick the closest match">What happened?</SectionLabel>
        <View style={s.grid}>
          {CATEGORIES.map((c) => {
            const on = category === c.value;
            return (
              <TouchableOpacity key={c.value} onPress={() => setCategory(c.value)} activeOpacity={0.8}
                accessibilityRole="radio" accessibilityState={{ selected: on }} style={[s.tile, on && s.tileOn]}>
                <View style={[s.tileIcon, on && s.tileIconOn]}>
                  <Ionicons name={CATEGORY_ICONS[c.value]} size={20} color={on ? '#fff' : colors.green} />
                </View>
                <Text style={[s.tileText, on && { color: colors.green }]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <SectionLabel hint="How is the patient right now?">Patient condition</SectionLabel>
        <View style={s.chips}>
          {PATIENT_STATUSES.map((o) => (
            <Chip key={o.value} label={o.label} selected={patientStatus === o.value}
              critical={CRITICAL_STATUSES.includes(o.value)} onPress={() => setPatientStatus(o.value)} />
          ))}
        </View>

        <SectionLabel hint="Optional, but it helps responders prepare">Patient details</SectionLabel>
        <View style={s.seg}>
          {SEXES.map((o) => {
            const on = sex === o.value;
            return (
              <TouchableOpacity key={o.value} onPress={() => setSex(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={[s.segBtn, on && s.segBtnOn]}>
                <Text style={[s.segText, on && { color: '#fff' }]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Input icon="calendar-outline" keyboardType="number-pad" value={age} onChangeText={setAge} placeholder="Age (e.g. 19)" maxLength={3} />
        <Input icon="create-outline" multiline value={nature} onChangeText={setNature} placeholder="What happened? e.g. Fell from the stairs, hit head" />

        <SectionLabel hint="Responders will use your pin and this description">Where are you?</SectionLabel>
        <View style={[s.loc, locState === 'ok' && s.locOk, locState === 'off' && s.locOff]}>
          {locState === 'wait'
            ? <ActivityIndicator color={colors.green} />
            : <Ionicons name={locState === 'ok' ? 'location' : 'location-outline'} size={24} color={locState === 'ok' ? colors.green : colors.goldInk} />}
          <View style={{ flex: 1 }}>
            <Text style={s.locTitle}>{locState === 'ok' ? 'GPS location pinned' : locState === 'wait' ? 'Finding your location' : 'Location unavailable'}</Text>
            <Text style={s.locSub}>
              {locState === 'ok' ? `Accurate to about ${Math.round(coords.accuracy || 0)} m` : locState === 'wait' ? 'This can take a few seconds' : locMsg}
            </Text>
          </View>
        </View>
        <Input icon="navigate-outline" value={place} onChangeText={setPlace} placeholder="Room or landmark, e.g. Gym entrance, 2nd floor" />
      </ScrollView>

      <View style={[s.bar, { paddingBottom: insets.bottom + 12 }]}>
        <Button title="Send SOS" icon="alert-circle" variant="danger" onPress={send} busy={busy} />
        <Text style={s.hint}>No internet? We will open a text message to the infirmary instead.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40 },
  who: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.goldSoft, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  whoText: { color: colors.goldInk, fontWeight: '700', fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, padding: 12, minHeight: 60 },
  tileOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  tileIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  tileIconOn: { backgroundColor: colors.green },
  tileText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  seg: { flexDirection: 'row', backgroundColor: '#E8EEE8', borderRadius: radius.md, padding: 4, marginBottom: 12 },
  segBtn: { flex: 1, paddingVertical: 11, borderRadius: radius.sm, alignItems: 'center' },
  segBtnOn: { backgroundColor: colors.green },
  segText: { fontSize: 14, fontWeight: '700', color: colors.ink },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: radius.md, padding: 14, marginBottom: 12, borderWidth: 1.5, borderColor: colors.line },
  locOk: { backgroundColor: colors.greenSoft, borderColor: colors.mint },
  locOff: { backgroundColor: colors.goldSoft, borderColor: colors.gold },
  locTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  locSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  bar: { backgroundColor: '#fff', paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  hint: { color: colors.muted, textAlign: 'center', fontSize: 12, marginTop: 8 },
});
