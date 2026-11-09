import React from 'react';
import { ActivityIndicator, View } from 'react-native';
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

function Routes() {
  const { user, loading } = useAuth();
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color={colors.teal} /></View>;
  return (
    <Stack.Navigator screenOptions={{ headerTintColor: colors.ink }}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'CampusSOS' }} />
          <Stack.Screen name="SosForm" component={SosFormScreen} options={{ title: 'Emergency details' }} />
          <Stack.Screen name="Tips" component={TipsScreen} options={{ title: 'While help is coming', headerBackVisible: false }} />
          <Stack.Screen name="Log" component={LogScreen} options={{ title: 'My incident log' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <Routes />
      </NavigationContainer>
    </AuthProvider>
  );
}
