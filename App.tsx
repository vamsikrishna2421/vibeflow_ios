import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import React, { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NavProvider, useNav } from '@/navigation/nav';
import { RootNavigator } from '@/navigation/RootNavigator';
import { StoreProvider } from '@/store';
import { Colors } from '@/theme/colors';

/**
 * App entry. Providers wrap the tree:
 *   StoreProvider  → persistent state + App-Group mirror
 *   NavProvider    → tabs + stack + the keyboard deep-link signal
 * Everything below the native shell rides EAS Update OTA.
 */
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaProvider>
        <StoreProvider>
          <NavProvider>
            <StatusBar style="light" />
            <DeepLinkBridge />
            <RootNavigator />
          </NavProvider>
        </StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The keyboard opens `vibeflow://record` to ask the app to start dictating.
 * Translate that into a `requestRecord()` so the Talk screen begins immediately.
 */
function DeepLinkBridge() {
  const { requestRecord } = useNav();
  // Keep the latest callback in a ref so the effect below can run EXACTLY once.
  // (Depending on `requestRecord` re-ran the effect every nonce bump, re-reading
  // the same initial URL → infinite request loop → the UI flickered.)
  const requestRef = useRef(requestRecord);
  requestRef.current = requestRecord;
  useEffect(() => {
    const handle = (url: string | null) => {
      if (url && url.includes('record')) {
        const host = /[?&]host=([A-Za-z0-9.\-]+)/.exec(url)?.[1] ?? null;
        requestRef.current(host);
      }
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);
  return null;
}
