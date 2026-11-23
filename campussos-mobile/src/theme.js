// CSU palette: Dark Green #1B651B, Gold #FFD700, Bright Green #02E49B, White.
// Red stays only for SOS and danger so emergencies are recognised instantly.
export const colors = {
  green: '#1B651B', greenDark: '#0F4A12', greenSoft: '#E7F3E7',
  gold: '#FFD700', goldSoft: '#FFF6C2', goldInk: '#6B5600',
  mint: '#02E49B',
  white: '#FFFFFF', paper: '#F5F8F5', ink: '#10281A', muted: '#5C6E60', line: '#DCE6DC',
  alert: '#D3202F', alertDark: '#A8101D', alertSoft: '#FDECEE',
  // legacy names so old imports keep working
  panel: '#FFFFFF', teal: '#1B651B', amber: '#6B5600', ok: '#1B651B',
};
export const radius = { sm: 10, md: 14, lg: 20, xl: 28 };
export const shadow = {
  shadowColor: '#0B2A10', shadowOpacity: 0.1, shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 }, elevation: 3,
};
