import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, brandGradient, micGradient, Radius } from '@/theme/colors';

/**
 * Home / Talk. This is the M1 buildable shell with the brand identity in place;
 * the live recorder (waveform + on-device dictation), stats strip, and privacy
 * controls land in M3/M4. The text pipeline that formats dictations is already
 * done & tested in `@/core`.
 */
export function HomeScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
    >
      <View style={styles.wordmarkRow}>
        <Text style={styles.wordmark}>Vibe</Text>
        <Text style={[styles.wordmark, { color: Colors.brand }]}>Flow</Text>
      </View>
      <Text style={styles.tagline}>Speak. We&apos;ll write it, beautifully.</Text>

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Tap to talk</Text>
        <Text style={styles.heroSub}>I&apos;ll write it down and copy it for you.</Text>
        <View style={styles.micWrap}>
          <LinearGradient colors={micGradient} style={styles.mic}>
            <Ionicons name="mic" size={40} color="#fff" />
          </LinearGradient>
        </View>
      </View>

      <View style={styles.steps}>
        <Text style={styles.stepsTitle}>Type anywhere by voice</Text>
        <Step n="1" t="Dictate here in VibeFlow." />
        <Step n="2" t="Switch to the VibeFlow keyboard (🌐 globe key)." />
        <Step n="3" t="Tap “Insert latest” — your words land at the cursor." />
      </View>
    </ScrollView>
  );
}

function Step({ n, t }: { n: string; t: string }) {
  return (
    <View style={styles.step}>
      <LinearGradient colors={brandGradient} style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </LinearGradient>
      <Text style={styles.stepText}>{t}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 22, paddingBottom: 40 },
  wordmarkRow: { flexDirection: 'row' },
  wordmark: { color: Colors.ink, fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { color: Colors.inkSoft, fontSize: 15, marginTop: 2 },
  hero: {
    marginTop: 24,
    backgroundColor: Colors.surfaceVariant,
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
  },
  heroTitle: { color: Colors.ink, fontSize: 22, fontWeight: '700' },
  heroSub: { color: Colors.inkSoft, fontSize: 14, marginTop: 4, textAlign: 'center' },
  micWrap: { marginTop: 24 },
  mic: { width: 94, height: 94, borderRadius: 47, alignItems: 'center', justifyContent: 'center' },
  steps: { marginTop: 28 },
  stepsTitle: { color: Colors.ink, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  step: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 12 },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  stepText: { color: Colors.ink, fontSize: 14, flex: 1 },
});
