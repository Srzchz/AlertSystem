import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { io } from 'socket.io-client';
import { useAuth } from '../AuthContext';
import { API_URL, INFIRMARY_NUMBER } from '../config';
import { FIRST_AID } from '../data/firstAid';
import { STATUS_LABELS } from '../data/options';
import { Button } from '../components/ui';
import { colors, radius, shadow } from '../theme';

const STEPS = ['PENDING', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SCENE'];

function Stepper({ status }) {
  if (status === 'CANCELLED') return <Text style={s.cancelled}>This alert was cancelled.</Text>;
  const idx = status === 'RESOLVED' ? STEPS.length : Math.max(0, STEPS.indexOf(status));
  return (
    <View style={s.stepper}>
      {STEPS.map((k, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <View key={k} style={s.step}>
            <View style={s.stepTrack}>
              <View style={[s.line, i === 0 && { opacity: 0 }, i <= idx && { backgroundColor: colors.mint }]} />
              <View style={[s.dot, done && { backgroundColor: colors.mint }, current && { backgroundColor: colors.gold }]}>
                {done && <Ionicons name="checkmark" size={14} color={colors.greenDark} />}
              </View>
              <View style={[s.line, i === STEPS.length - 1 && { opacity: 0 }, i < idx && { backgroundColor: colors.mint }]} />
            </View>
            <Text style={[s.stepLabel, (done || current) && { color: '#fff', fontWeight: '700' }]}>{STATUS_LABELS[k]}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function TipsScreen({ route, navigation }) {
  const { category, via, incidentId } = route.params;
  const { token } = useAuth();
  const [status, setStatus] = useState('PENDING');

  // Live status updates ("on the way") when the alert was sent online
  useEffect(() => {
    if (via !== 'app') return;
    const socket = io(API_URL, { auth: { token }, transports: ['websocket'] });
    socket.on('incident:update', (inc) => { if (inc._id === incidentId) setStatus(inc.status); });
    return () => socket.disconnect();
  }, [via, token, incidentId]);

  const sms = via === 'sms';
  return (
    <ScrollView contentContainerStyle={s.wrap}>
      {sms ? (
        <View style={[s.banner, { backgroundColor: colors.gold }]}>
          <View style={[s.bannerIcon, { backgroundColor: '#fff' }]}><Ionicons name="chatbubble-ellipses" size={26} color={colors.goldInk} /></View>
          <Text style={[s.bannerTitle, { color: colors.ink }]}>One more step</Text>
          <Text style={[s.bannerSub, { color: colors.ink }]}>Your SMS app opened. Press send there so the infirmary gets your alert.</Text>
        </View>
      ) : (
        <View style={s.banner}>
          <View style={s.bannerIcon}><Ionicons name="checkmark" size={30} color={colors.greenDark} /></View>
          <Text style={s.bannerTitle}>Alert sent</Text>
          <Text style={s.bannerSub}>The infirmary can see your location.</Text>
          <Stepper status={status} />
        </View>
      )}

      <Button title="Call the infirmary" icon="call" variant="outline" onPress={() => Linking.openURL(`tel:${INFIRMARY_NUMBER}`)} style={{ marginTop: 14 }} />

      <Text style={s.head}>Do this while you wait</Text>
      {FIRST_AID[category].map((tip, i) => (
        <View key={i} style={s.tip}>
          <View style={s.num}><Text style={s.numText}>{i + 1}</Text></View>
          <Text style={s.tipText}>{tip}</Text>
        </View>
      ))}
      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={20} color={colors.muted} />
        <Text style={s.noteText}>These tips are general. Follow any instructions from the infirmary staff first.</Text>
      </View>
      <Button title="Back to home" onPress={() => navigation.popToTop()} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40 },
  banner: { backgroundColor: colors.green, borderRadius: radius.lg, padding: 20, alignItems: 'center', ...shadow },
  bannerIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  bannerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  bannerSub: { color: 'rgba(255,255,255,0.9)', textAlign: 'center', marginTop: 4, fontSize: 15, lineHeight: 21 },
  stepper: { flexDirection: 'row', marginTop: 20, alignSelf: 'stretch' },
  step: { flex: 1, alignItems: 'center' },
  stepTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  line: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  dot: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  stepLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 6, textAlign: 'center' },
  cancelled: { color: '#fff', marginTop: 14, fontWeight: '700' },
  head: { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 26, marginBottom: 12 },
  tip: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: radius.md, padding: 14, marginBottom: 10, alignItems: 'flex-start', ...shadow, shadowOpacity: 0.06 },
  num: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  numText: { fontWeight: '800', color: colors.ink, fontSize: 15 },
  tipText: { flex: 1, fontSize: 17, color: colors.ink, lineHeight: 24 },
  note: { flexDirection: 'row', gap: 8, marginVertical: 14, alignItems: 'flex-start' },
  noteText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 18 },
});
