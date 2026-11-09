import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import { CATEGORIES, STATUS_LABELS, labelOf } from '../data/options';
import { colors } from '../theme';

const dur = (sec) => (sec == null ? 'Not yet' : sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`);

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

  if (!items && !error) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.teal} />;
  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={items || []}
      keyExtractor={(i) => i._id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListEmptyComponent={<Text style={s.empty}>{error || 'No incidents yet. Alerts you send will be listed here.'}</Text>}
      renderItem={({ item: i }) => (
        <View style={s.card}>
          <Text style={s.title}>{labelOf(CATEGORIES, i.category)} <Text style={s.status}>{STATUS_LABELS[i.status]}</Text></Text>
          <Text style={s.meta}>{new Date(i.createdAt).toLocaleString()}</Text>
          <Text>Location: {i.location?.description || (i.location?.lat != null ? `${i.location.lat.toFixed(4)}, ${i.location.lng.toFixed(4)}` : '-')}</Text>
          <Text>Response time: {dur(i.responseTimeSec)}</Text>
          <Text>Outcome: {i.outcome || 'Pending'}</Text>
          {!!i.notes && <Text>Notes: {i.notes}</Text>}
        </View>
      )}
    />
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink },
  status: { color: colors.teal, fontSize: 14 },
  meta: { color: colors.muted, marginBottom: 6 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40 },
});
