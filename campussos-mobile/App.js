import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DeviceProvider } from './src/DeviceContext';
import { colors } from './src/theme';
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

// No login: the app opens straight to Home and always has these four screens.
function Routes() {
  return (
    <Stack.Navigator initialRouteName="Home" screenOptions={headerOptions}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false, title: 'CampusSOS' }} />
      <Stack.Screen name="SosForm" component={SosFormScreen} options={{ title: 'Emergency details' }} />
      <Stack.Screen name="Tips" component={TipsScreen} options={{ title: 'Help is on the way', headerBackVisible: false }} />
      <Stack.Screen name="Log" component={LogScreen} options={{ title: 'My incident log' }} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <DeviceProvider>
        <NavigationContainer>
          <Routes />
        </NavigationContainer>
      </DeviceProvider>
    </SafeAreaProvider>
  );
}
