import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { io } from 'socket.io-client';
import { useAuth } from '../AuthContext';
import { API_URL } from '../config';
import { FIRST_AID } from '../data/firstAid';
import { STATUS_LABELS } from '../data/options';
import { colors } from '../theme';

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

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <View style={s.banner}>
        <Text style={s.bannerTitle}>{via === 'sms' ? 'Finish sending the text message' : 'Alert sent'}</Text>
        <Text style={s.bannerSub}>
          {via === 'sms' ? 'Your SMS app opened. Press send there so the infirmary gets your alert.' : `Status: ${STATUS_LABELS[status]}. The infirmary can see your location.`}
        </Text>
      </View>
      <Text style={s.head}>Do this while you wait</Text>
      {FIRST_AID[category].map((tip, i) => (
        <View key={i} style={s.tip}><Text style={s.tipText}>{tip}</Text></View>
      ))}
      <Text style={s.note}>These tips are general. Follow any instructions from the infirmary staff first.</Text>
      <TouchableOpacity style={s.done} onPress={() => navigation.popToTop()}><Text style={s.doneText}>Back to home</Text></TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, backgroundColor: colors.paper },
  banner: { backgroundColor: '#e3f4e8', borderRadius: 10, padding: 16, marginBottom: 18 },
  bannerTitle: { fontSize: 18, fontWeight: '700', color: colors.ok },
  bannerSub: { color: colors.ink, marginTop: 4 },
  head: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  tip: { backgroundColor: colors.panel, borderLeftWidth: 5, borderLeftColor: colors.teal, borderRadius: 8, padding: 14, marginBottom: 10 },
  tipText: { fontSize: 17, color: colors.ink, lineHeight: 24 },
  note: { color: colors.muted, marginVertical: 12 },
  done: { padding: 14, alignItems: 'center' },
  doneText: { color: colors.teal, fontSize: 16, fontWeight: '700' },
});
