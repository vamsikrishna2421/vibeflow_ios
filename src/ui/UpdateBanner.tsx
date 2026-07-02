/**
 * OTA update prompt — checks for a new JS update on launch and whenever the app
 * comes to the foreground; once one is downloaded, shows a GOLDEN card (glowing,
 * deliberately unmissable against the dark UI) so the user restarts consciously.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Updates from 'expo-updates';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GOLD_EDGE = ['#F7D774', '#D4A017', '#FFE9A8'] as const;
const GOLD_BTN = ['#E8B923', '#C98F0A'] as const;

export function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;

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

  // Soft golden pulse so the card catches the eye without being obnoxious.
  useEffect(() => {
    if (!ready) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ready, glow]);

  if (!ready) return null;
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 84 }]} pointerEvents="box-none">
      <Animated.View style={{ opacity: glowOpacity }}>
        {/* Golden edge: gradient border via padded gradient behind the card */}
        <LinearGradient colors={[...GOLD_EDGE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.edge}>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.medal}>
                <Ionicons name="sparkles" size={18} color="#3A2A00" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Update ready ✨</Text>
                <Text style={styles.sub}>New improvements are downloaded — restart to unlock them.</Text>
              </View>
            </View>
            <Pressable onPress={() => Updates.reloadAsync().catch(() => {})} style={({ pressed }) => [pressed && { opacity: 0.9 }]}>
              <LinearGradient colors={[...GOLD_BTN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btn}>
                <Ionicons name="refresh" size={16} color="#231A00" />
                <Text style={styles.btnText}>Restart now</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  edge: {
    borderRadius: 24,
    padding: 1.5,
    shadowColor: '#E8B923',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  card: {
    backgroundColor: '#1A1406',
    borderRadius: 22.5,
    padding: 14,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  medal: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2CA52',
  },
  title: { color: '#FFE9A8', fontSize: 16, fontWeight: '800' },
  sub: { color: 'rgba(255,233,168,0.75)', fontSize: 12.5, marginTop: 2 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 12,
  },
  btnText: { color: '#231A00', fontSize: 14.5, fontWeight: '800' },
});
