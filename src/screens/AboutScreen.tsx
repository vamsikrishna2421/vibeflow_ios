/**
 * About — the quiet, premium credits + trust screen. Tells people what version
 * they're on, that recognition runs on-device, and how VibeFlow handles their
 * words (it doesn't — nothing leaves the phone). Plus the standard links Apple
 * expects: privacy policy, support, and a rating prompt.
 */
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import React from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { useNav } from '@/navigation/nav';
import { useStore } from '@/store';
import { Colors } from '@/theme/colors';
import { Badge, Card, NavRow, Screen, SectionTitle, Type } from '@/ui/kit';

type IconName = keyof typeof Ionicons.glyphMap;

export function AboutScreen() {
  const { pop } = useNav();
  const { premium } = useStore();

  const version = Constants.expoConfig?.version ?? '1.0.0';

  const openURL = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Couldn’t open link', 'Something went wrong. Please try again later.');
    }
  };

  return (
    <Screen title="About" onBack={pop}>
      {/* Brand */}
      <View style={styles.brand}>
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>Vibe</Text>
          <Text style={[styles.wordmark, { color: Colors.brand }]}>Flow</Text>
        </View>
        <Text style={styles.tagline}>Speak. We’ll write it, beautifully.</Text>
      </View>

      {/* At a glance */}
      <SectionTitle>At a glance</SectionTitle>
      <Card padded={false}>
        <InfoRow icon="pricetag-outline" label="Version" value={version} first />
        <RowDivider />
        <InfoRow icon="sparkles-outline" label="Status" badge={premium ? 'Pro' : 'Free'} badgeTone={premium ? 'brand' : 'muted'} />
        <RowDivider />
        <InfoRow icon="hardware-chip-outline" label="Recognition" value="On-device" last />
      </Card>

      {/* Privacy */}
      <SectionTitle>Privacy</SectionTitle>
      <Card>
        <View style={styles.privacyHead}>
          <View style={styles.privacyIcon}>
            <Ionicons name="lock-closed" size={18} color={Colors.brand} />
          </View>
          <Text style={[Type.label, { flex: 1 }]}>Private by design</Text>
        </View>
        <Text style={[Type.bodySoft, styles.privacyBody]}>
          Speech recognition happens entirely on your iPhone — your voice never leaves the
          device. The VibeFlow keyboard requests no “Full Access,” so it can’t see what you
          type elsewhere. Your dictations and snippets are shared between the app and the
          keyboard through a private App Group on your device alone.
        </Text>
      </Card>

      {/* Links */}
      <SectionTitle>More</SectionTitle>
      <Card padded={false}>
        <View style={styles.linkRow}>
          <NavRow
            icon="shield-checkmark-outline"
            label="Privacy policy"
            subtitle="How we handle your data"
            onPress={() => openURL('https://vibeflow.app/privacy')}
          />
        </View>
        <RowDivider />
        <View style={styles.linkRow}>
          <NavRow
            icon="mail-outline"
            label="Contact support"
            subtitle="support@vibeflow.app"
            onPress={() => openURL('mailto:support@vibeflow.app')}
          />
        </View>
        <RowDivider />
        <View style={styles.linkRow}>
          <NavRow
            icon="star-outline"
            label="Rate VibeFlow"
            subtitle="Tell others on the App Store"
            onPress={() => openURL('https://apps.apple.com/')}
          />
        </View>
      </Card>

      <Text style={styles.footer}>Made for people who’d rather talk than type.</Text>
    </Screen>
  );
}

// --- info row (icon + label + value/badge) -----------------------------------

function InfoRow({
  icon,
  label,
  value,
  badge,
  badgeTone = 'brand',
  first,
  last,
}: {
  icon: IconName;
  label: string;
  value?: string;
  badge?: string;
  badgeTone?: 'brand' | 'amber' | 'muted';
  first?: boolean;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.infoRow,
        first && { paddingTop: 16 },
        last && { paddingBottom: 16 },
      ]}
    >
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={18} color={Colors.brand} />
      </View>
      <Text style={[Type.label, { flex: 1 }]}>{label}</Text>
      {badge ? (
        <Badge label={badge} tone={badgeTone} />
      ) : (
        <Text style={Type.bodySoft}>{value}</Text>
      )}
    </View>
  );
}

function RowDivider() {
  return <View style={styles.rowDivider} />;
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
  wordmarkRow: { flexDirection: 'row' },
  wordmark: { color: Colors.ink, fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  tagline: { color: Colors.inkSoft, fontSize: 15, marginTop: 8 },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  infoIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.outline,
    marginLeft: 64,
  },

  privacyHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  privacyIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyBody: { marginTop: 12 },

  linkRow: { paddingHorizontal: 16 },

  footer: {
    color: Colors.inkFaint,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 28,
    marginBottom: 8,
  },
});
