import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeScreen } from '@/screens/HomeScreen';
import { Colors } from '@/theme/colors';

type Tab = 'home' | 'history' | 'settings';

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'home', label: 'Talk', icon: 'mic' },
  { key: 'history', label: 'History', icon: 'time' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

/**
 * Lightweight custom tab navigation (no react-navigation — keeps the bundle lean
 * and the screen set is small, mirroring LUCY's approach). History & Settings are
 * M3 placeholders for now.
 */
export function RootNavigator() {
  const [tab, setTab] = useState<Tab>('home');
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === 'home' && <HomeScreen />}
        {tab === 'history' && <Placeholder title="History" />}
        {tab === 'settings' && <Placeholder title="Settings" />}
      </View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
              <Ionicons name={t.icon} size={22} color={active ? Colors.brand : Colors.inkFaint} />
              <Text style={[styles.tabLabel, { color: active ? Colors.brand : Colors.inkFaint }]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderText}>{title}</Text>
      <Text style={styles.placeholderSub}>Coming together in the next slice.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.outline,
    backgroundColor: Colors.surface,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabLabel: { fontSize: 11, fontWeight: '600' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  placeholderText: { color: Colors.ink, fontSize: 22, fontWeight: '700' },
  placeholderSub: { color: Colors.inkSoft, fontSize: 14 },
});
