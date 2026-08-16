import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { AuthProvider } from "@/src/auth-context";

LogBox.ignoreAllLogs(true);

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconError] = useIconFonts();
  const [appLoaded, appError] = useAppFonts();

  useEffect(() => {
    if ((iconsLoaded || iconError) && (appLoaded || appError)) {
      SplashScreen.hideAsync();
    }
  }, [iconsLoaded, iconError, appLoaded, appError]);

  // If a CDN font fails, we still boot — text just falls back to system fonts.
  if (!iconsLoaded && !iconError) return null;
  if (!appLoaded && !appError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#0B0D12" }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar barStyle="light-content" backgroundColor="#0B0D12" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0B0D12" } }} />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
