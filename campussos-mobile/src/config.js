import { Platform } from 'react-native';

// Browser: use the address the page was opened from. Phone app: your laptop's IPv4 (run ipconfig).
const host = Platform.OS === 'web' ? window.location.hostname : '192.168.18.183'; // change to your IPv4

export const API_URL = `http://${host}:4000`;

// Number the offline SMS fallback is sent to (your SMS gateway / infirmary hotline).
export const INFIRMARY_NUMBER = '+639000000000';
