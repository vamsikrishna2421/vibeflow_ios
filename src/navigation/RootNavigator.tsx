/**
 * Root shell: three base tabs (Talk / History / Settings) plus a full-screen
 * "stack" overlay for pushed routes (snippets, vocabulary, …). Lightweight by
 * design — no react-navigation — mirroring LUCY.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StackRoute, Tab, useNav } from '@/navigation/nav';
import { AboutScreen } from '@/screens/AboutScreen';
import { CorrectionsScreen } from '@/screens/CorrectionsScreen';
import { HistoryScreen } from '@/screens/HistoryScreen';
import { KeyboardSetupScreen } from '@/screens/KeyboardSetupScreen';
import { PaywallScreen } from '@/screens/PaywallScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SnippetsScreen } from '@/screens/SnippetsScreen';
import { TalkScreen } from '@/screens/TalkScreen';
import { VocabularyScreen } from '@/screens/VocabularyScreen';
import { Colors } from '@/theme/colors';
import { haptic } from '@/ui/kit';

const STACK_SCREENS: Record<StackRoute, React.ComponentType> = {
  snippets: SnippetsScreen,
  vocabulary: VocabularyScreen,
  corrections: CorrectionsScreen,
  keyboardSetup: KeyboardSetupScreen,
  paywall: PaywallScreen,
  about: AboutScreen,
};

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'home', label: 'Talk', icon: 'mic' },
  { key: 'history', label: 'History', icon: 'time' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

export function RootNavigator() {
  const { tab, stack, setTab } = useNav();
  const insets = useSafeAreaInsets();

  const top = stack[stack.length - 1];
  const TopScreen = top ? STACK_SCREENS[top] : null;

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === 'home' && <TalkScreen />}
        {tab === 'history' && <HistoryScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => {
                haptic.tap();
                setTab(t.key);
              }}
            >
              <Ionicons name={t.icon} size={22} color={active ? Colors.brand : Colors.inkFaint} />
              <Text style={[styles.tabLabel, { color: active ? Colors.brand : Colors.inkFaint }]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {TopScreen ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.background }]}>
          <TopScreen />
        </View>
      ) : null}
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
});
