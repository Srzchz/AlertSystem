import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from './src/AuthContext';
import { colors } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import SosFormScreen from './src/screens/SosFormScreen';
import TipsScreen from './src/screens/TipsScreen';
import LogScreen from './src/screens/LogScreen';

const Stack = createNativeStackNavigator();

const headerOptions = {
  headerStyle: { backgroundColor: colors.green },
  headerTintColor: '#fff',
  headerTitleStyle: { fontWeight: '700' },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.paper },
};

function Routes() {
  const { user, loading } = useAuth();
  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.green }}><ActivityIndicator size="large" color={colors.gold} /></View>;
  }
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false, title: 'CampusSOS' }} />
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false, title: 'CampusSOS' }} />
          <Stack.Screen name="SosForm" component={SosFormScreen} options={{ title: 'Emergency details' }} />
          <Stack.Screen name="Tips" component={TipsScreen} options={{ title: 'Help is on the way', headerBackVisible: false }} />
          <Stack.Screen name="Log" component={LogScreen} options={{ title: 'My incident log' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <NavigationContainer>
          <Routes />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
