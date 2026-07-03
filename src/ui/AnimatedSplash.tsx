/**
 * Animated splash — continues seamlessly from the native splash (same dark
 * background, same centered logo), then brings it to life: the logo glows and
 * settles, the wordmark rises in, and the whole thing melts into the app.
 * Pure JS/Animated → ships and iterates over OTA.
 */
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

// Keep the native splash up until our overlay has rendered its first frame.
SplashScreen.preventAutoHideAsync().catch(() => {});

const LOGO = require('../../assets/splash.png');

export function AnimatedSplash({ children }: { children: React.ReactNode }) {
  const [done, setDone] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const wordmark = useRef(new Animated.Value(0)).current;
  const fadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // Breathe: glow up while the logo settles slightly larger.
      Animated.parallel([
        Animated.timing(glow, { toValue: 1, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(logoScale, { toValue: 1.06, useNativeDriver: true, speed: 4, bounciness: 8 }),
      ]),
      // Wordmark rises in.
      Animated.timing(wordmark, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(320),
      // Melt into the app.
      Animated.timing(fadeOut, { toValue: 0, duration: 420, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => setDone(true));
  }, [glow, logoScale, wordmark, fadeOut]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {!done ? (
        <Animated.View
          style={[styles.overlay, { opacity: fadeOut }]}
          onLayout={() => SplashScreen.hideAsync().catch(() => {})}
          pointerEvents="none"
        >
          <Animated.View style={{ opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }) }}>
            <LinearGradient
              colors={['rgba(124,92,255,0.5)', 'rgba(124,92,255,0.12)', 'rgba(124,92,255,0)']}
              locations={[0, 0.55, 1]}
              style={styles.glow}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            />
          </Animated.View>
          <Animated.Image
            source={LOGO}
            style={[styles.logo, { transform: [{ scale: logoScale }] }]}
            resizeMode="contain"
          />
          <Animated.View
            style={{
              opacity: wordmark,
              transform: [{ translateY: wordmark.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
            }}
          >
            <Text style={styles.wordmark}>
              Vibe<Text style={{ color: '#7C5CFF' }}>Flow</Text>
            </Text>
            <Text style={styles.tagline}>speak it. send it.</Text>
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#0B0A14', // must match the native splash background exactly
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    alignSelf: 'center',
    width: 300,
    height: 300,
    borderRadius: 150,
    top: -150,
    opacity: 0.9,
  },
  logo: { width: 168, height: 168, borderRadius: 38 },
  wordmark: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 18,
  },
  tagline: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
