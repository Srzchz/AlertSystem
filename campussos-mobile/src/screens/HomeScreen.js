import React, { useEffect, useRef } from 'react';
import { Alert, Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../AuthContext';
import { colors, radius, shadow } from '../theme';

const SIZE = 190;

function Pulse({ delay }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[s.ring, {
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
      }]}
    />
  );
}

function Tile({ icon, title, sub, onPress, tint, bg }) {
  return (
    <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
      <View style={[s.tileIcon, { backgroundColor: bg }]}><Ionicons name={icon} size={22} color={tint} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.tileTitle}>{title}</Text>
        {!!sub && <Text style={s.tileSub}>{sub}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const confirmLogout = () => Alert.alert('Log out?', 'You will need to log in again to send an alert.', [
    { text: 'Stay logged in', style: 'cancel' },
    { text: 'Log out', style: 'destructive', onPress: logout },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.topRow}>
          <View style={s.brand}>
            <View style={s.brandIcon}><Ionicons name="shield-checkmark" size={18} color={colors.green} /></View>
            <Text style={s.brandText}>CampusSOS</Text>
          </View>
          <TouchableOpacity style={s.iconBtn} onPress={confirmLogout} accessibilityLabel="Log out" hitSlop={8}>
            <Ionicons name="log-out-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={s.hello}>Hi, {user.name.split(' ')[0]}</Text>
        <Text style={s.helloSub}>Stay calm. Help is one tap away.</Text>
        <View style={s.goldBar} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <Text style={s.caption}>In an emergency, tap the button</Text>
        <View style={s.heroWrap}>
          <Pulse delay={0} />
          <Pulse delay={1100} />
          <TouchableOpacity
            style={s.sos} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel="SOS. I need help."
            onPress={() => navigation.navigate('SosForm', { forSelf: true })}
          >
            <Text style={s.sosText}>SOS</Text>
            <Text style={s.sosSub}>I need help</Text>
          </TouchableOpacity>
        </View>

        <Tile icon="people" title="Someone else needs help" sub="Report for another person" tint={colors.goldInk} bg={colors.gold}
          onPress={() => navigation.navigate('SosForm', { forSelf: false })} />
        <Tile icon="time-outline" title="My incident log" sub="See your past alerts and response times" tint={colors.green} bg={colors.greenSoft}
          onPress={() => navigation.navigate('Log')} />

        <View style={s.info}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.green} />
          <Text style={s.infoText}>No internet? The app will open a text message to the infirmary instead.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: colors.green, paddingHorizontal: 20, paddingBottom: 26, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  brandText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  hello: { color: '#fff', fontSize: 30, fontWeight: '800' },
  helloSub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, marginTop: 4 },
  goldBar: { width: 44, height: 4, borderRadius: 2, backgroundColor: colors.gold, marginTop: 14 },
  caption: { textAlign: 'center', color: colors.muted, fontSize: 14, fontWeight: '600', marginTop: 4 },
  heroWrap: { height: 270, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: colors.alert },
  sos: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: colors.alert, alignItems: 'center', justifyContent: 'center',
    borderWidth: 6, borderColor: '#fff', shadowColor: colors.alert, shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  sosText: { color: '#fff', fontSize: 54, fontWeight: '900', letterSpacing: 2 },
  sosSub: { color: '#fff', fontSize: 16, fontWeight: '600', opacity: 0.95, marginTop: -2 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, marginBottom: 12, ...shadow },
  tileIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  tileSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.greenSoft, borderRadius: radius.md, padding: 14, marginTop: 6 },
  infoText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 18 },
});
