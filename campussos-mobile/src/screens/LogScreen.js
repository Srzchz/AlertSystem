import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import { CATEGORIES, CATEGORY_ICONS, STATUS_LABELS, labelOf } from '../data/options';
import { colors, radius, shadow } from '../theme';

const dur = (sec) => (sec == null ? 'Not yet' : sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`);

const PILL = {
  PENDING: [colors.goldSoft, colors.goldInk],
  ACKNOWLEDGED: [colors.greenSoft, colors.green],
  EN_ROUTE: [colors.greenSoft, colors.green],
  ON_SCENE: [colors.greenSoft, colors.green],
  RESOLVED: [colors.green, '#fff'],
  CANCELLED: ['#ECEFEC', colors.muted],
};

function Row({ icon, label, value }) {
  return (
    <View style={s.row}>
      <Ionicons name={icon} size={16} color={colors.muted} />
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

export default function LogScreen() {
  const { token } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api('/incidents/mine', { token })); setError(''); }
    catch (e) { setError(e.offline ? 'You are offline. Connect to see your log.' : e.message); }
  }, [token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!items && !error) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.green} />;
  return (
    <FlatList
      contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}
      data={items || []}
      keyExtractor={(i) => i._id}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.green} colors={[colors.green]} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListEmptyComponent={
        <View style={s.empty}>
          <View style={s.emptyIcon}><Ionicons name={error ? 'cloud-offline-outline' : 'document-text-outline'} size={34} color={colors.green} /></View>
          <Text style={s.emptyTitle}>{error ? 'Cannot load your log' : 'No incidents yet'}</Text>
          <Text style={s.emptyText}>{error || 'Alerts you send will be listed here.'}</Text>
        </View>
      }
      renderItem={({ item: i }) => {
        const [pbg, pfg] = PILL[i.status] || PILL.CANCELLED;
        const where = i.location?.description || (i.location?.lat != null ? `${i.location.lat.toFixed(4)}, ${i.location.lng.toFixed(4)}` : '-');
        return (
          <View style={s.card}>
            <View style={s.head}>
              <View style={s.icon}><Ionicons name={CATEGORY_ICONS[i.category] || 'medkit'} size={20} color={colors.green} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{labelOf(CATEGORIES, i.category)}</Text>
                <Text style={s.meta}>{new Date(i.createdAt).toLocaleString()}</Text>
              </View>
              <View style={[s.pill, { backgroundColor: pbg }]}><Text style={[s.pillText, { color: pfg }]}>{STATUS_LABELS[i.status]}</Text></View>
            </View>
            <View style={s.divider} />
            <Row icon="location-outline" label="Location" value={where} />
            <Row icon="timer-outline" label="Response time" value={dur(i.responseTimeSec)} />
            <Row icon="flag-outline" label="Outcome" value={i.outcome || 'Pending'} />
            {!!i.notes && <Row icon="document-text-outline" label="Notes" value={i.notes} />}
          </View>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, marginBottom: 12, ...shadow, shadowOpacity: 0.07 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: colors.ink },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  pillText: { fontSize: 12, fontWeight: '800' },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  rowLabel: { color: colors.muted, fontSize: 14, width: 104 },
  rowValue: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 80 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  emptyText: { color: colors.muted, textAlign: 'center', marginTop: 6, fontSize: 15 },
});
