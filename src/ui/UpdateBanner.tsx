/**
 * OTA update prompt — checks for a new JS update on launch and whenever the app
 * comes to the foreground; once one is downloaded, shows a card so the user can
 * restart deliberately instead of wondering whether they're on the latest code.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Updates from 'expo-updates';
import React, { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, micGradient } from '@/theme/colors';

export function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      if (__DEV__) return;
      try {
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) {
          await Updates.fetchUpdateAsync();
          if (mounted) setReady(true);
        }
      } catch {}
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  if (!ready) return null;
  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 84 }]} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="sparkles" size={20} color={Colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Update ready</Text>
            <Text style={styles.sub}>Restart now to get the latest improvements.</Text>
          </View>
        </View>
        <Pressable onPress={() => Updates.reloadAsync().catch(() => {})} style={({ pressed }) => [pressed && { opacity: 0.9 }]}>
          <LinearGradient colors={[...micGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btn}>
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.btnText}>Restart now</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'rgba(124,92,255,0.4)',
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: Colors.ink, fontSize: 15.5, fontWeight: '800' },
  sub: { color: Colors.inkFaint, fontSize: 12.5, marginTop: 2 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: Radius.pill,
    paddingVertical: 11,
  },
  btnText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
});
