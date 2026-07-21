/**
 * Settings detail screens — each section from the top-level Settings menu opens one
 * of these focused pages. Splitting the old single long scroll keeps every screen
 * short and scannable. Every toggle writes straight into the store (same behavior as
 * before — this is purely a navigation refactor).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import * as Updates from 'expo-updates';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PRO_ENABLED } from '@/config/features';
import { CurationOptions } from '@/core';
import { useAuth } from '@/hooks/useAuth';
import { deleteAccount } from '@/services/auth';
import { useNav } from '@/navigation/nav';
import { LANGUAGES, languageLabel, useStore } from '@/store';
import { getItem, removeItem, setItem } from '@/store/appGroup';
import { prefGet, prefRemove, prefSet } from '@/store/prefs';
import { Colors, Radius, Spacing } from '@/theme/colors';
import {
  Card,
  Divider,
  NavRow,
  PrimaryButton,
  Screen,
  SectionTitle,
  ToggleRow,
  Type,
  haptic,
} from '@/ui/kit';

// ── Recognition: on-device mode, language, voice commands ──────────────────────
export function RecognitionSettings() {
  const { pop } = useNav();
  const { settings, updateSettings } = useStore();
  const [langOpen, setLangOpen] = useState(false);

  return (
    <Screen title="Recognition" subtitle="How VibeFlow hears you" onBack={pop}>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="shield-checkmark-outline"
          tint={Colors.success}
          label="On-device only"
          subtitle="On by default — turn off for higher-accuracy cloud recognition"
          value={settings.onDeviceOnly}
          onValueChange={(v) => updateSettings({ onDeviceOnly: v })}
        />
        <Divider />
        <NavRow
          icon="language-outline"
          tint="#54A0FF"
          label="Language"
          value={languageLabel(settings.language)}
          onPress={() => setLangOpen(true)}
        />
      </Card>

      <SectionTitle>Voice commands</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="mic-outline"
          tint="#FF7A6B"
          label="Voice editing commands"
          subtitle="‘scratch that’, ‘delete last word’"
          value={settings.voiceCommands}
          onValueChange={(v) => updateSettings({ voiceCommands: v })}
        />
      </Card>

      <SectionTitle>Dictation length</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="infinite-outline"
          tint="#8E8CF0"
          label="Continuous dictation"
          subtitle="No time limit — keep talking; your words stream in as you go"
          value={settings.continuousDictation}
          onValueChange={(v) => updateSettings({ continuousDictation: v })}
        />
      </Card>
      <Text style={styles.explain}>
        On (recommended), the keyboard mic has no time limit — talk as long as you like and
        your words stream into the field as you speak. Turn it off for a single ~45-second
        recording with a countdown line, then a tap to continue.
      </Text>

      <Text style={styles.explain}>
        On-device (the default) keeps your voice private — it never leaves your phone. Turn
        “On-device only” off to use Apple’s cloud speech service, a larger, more accurate
        model (the same one the system keyboard mic uses).
      </Text>

      <LanguageSheet
        open={langOpen}
        current={settings.language}
        onClose={() => setLangOpen(false)}
        onPick={(code) => {
          updateSettings({ language: code });
          haptic.tap();
          setLangOpen(false);
        }}
      />
    </Screen>
  );
}

// ── Formatting: the on-device text-cleanup pipeline ────────────────────────────
export function FormattingSettings() {
  const { pop } = useNav();
  const { settings, updateSettings } = useStore();
  const setCuration = (patch: Partial<CurationOptions>) =>
    updateSettings({ curation: { ...settings.curation, ...patch } });
  const c = settings.curation;

  return (
    <Screen title="Formatting" subtitle="How your words are cleaned up" onBack={pop}>
      <SectionTitle>Punctuation & structure</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="chatbox-ellipses-outline"
          tint={Colors.brand}
          label="Spoken punctuation"
          subtitle="Say ‘comma’, ‘period’, ‘question mark’"
          value={c.spokenPunctuation}
          onValueChange={(v) => setCuration({ spokenPunctuation: v })}
        />
        <Divider />
        <ToggleRow
          icon="return-down-back-outline"
          tint="#32D4C8"
          label="Layout commands"
          subtitle="‘new line’, ‘new paragraph’"
          value={c.spokenCommands}
          onValueChange={(v) => setCuration({ spokenCommands: v })}
        />
        <Divider />
        <ToggleRow
          icon="ellipse-outline"
          tint="#8E8CF0"
          label="Auto end period"
          value={c.autoPeriod}
          onValueChange={(v) => setCuration({ autoPeriod: v })}
        />
      </Card>

      <SectionTitle>Capitalization</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="text-outline"
          tint="#FF9F0A"
          label="Capitalise sentences"
          value={c.capitalizeSentences}
          onValueChange={(v) => setCuration({ capitalizeSentences: v })}
        />
        <Divider />
        <ToggleRow
          icon="chevron-up-circle-outline"
          tint="#FFB84D"
          label="Capitalise first letter"
          value={c.capitalizeFirst}
          onValueChange={(v) => setCuration({ capitalizeFirst: v })}
        />
        <Divider />
        <ToggleRow
          icon="person-outline"
          tint="#FFD60A"
          label="Fix ‘i’ → ‘I’"
          value={c.fixPronounI}
          onValueChange={(v) => setCuration({ fixPronounI: v })}
        />
      </Card>

      <SectionTitle>Cleanup</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="sparkles-outline"
          tint="#FF6B9D"
          label="Remove fillers"
          subtitle="Drop ‘um’, ‘uh’…"
          value={c.stripFillers}
          onValueChange={(v) => setCuration({ stripFillers: v })}
        />
        <Divider />
        <ToggleRow
          icon="copy-outline"
          tint="#4DC4FF"
          label="Collapse repeats"
          value={c.dedupeRepeats}
          onValueChange={(v) => setCuration({ dedupeRepeats: v })}
        />
      </Card>
    </Screen>
  );
}

// ── Smart formatting (Pro) — one gated toggle + what it does ────────────────────
export function SmartFormatSettings() {
  const { pop, push } = useNav();
  const { settings, updateSettings, premium } = useStore();
  const { signedIn } = useAuth();
  const onToggleSmart = (v: boolean) => {
    if (v && !signedIn) {
      haptic.warning();
      return; // the free tier still needs an account (50 polishes/week ride the quota)
    }
    updateSettings({ smartFormat: v });
  };

  return (
    <Screen title="Smart formatting" subtitle="AI grammar & tone" onBack={pop}>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="color-wand-outline"
          label="Smart formatting"
          subtitle={signedIn ? 'AI cleans grammar & tone — 50 free/week' : 'Sign in to enable'}
          value={signedIn ? settings.smartFormat : false}
          onValueChange={onToggleSmart}
        />
      </Card>
      <Text style={styles.explain}>
        When on, each dictation is polished by VibeFlow’s AI — grammar, punctuation and
        tone — beyond the on-device formatting. 50 free polishes a week; unlimited with Pro.
      </Text>
      {PRO_ENABLED && !premium ? (
        <PrimaryButton
          label="See VibeFlow Pro"
          icon="sparkles"
          onPress={() => {
            haptic.tap();
            push('paywall');
          }}
          style={{ marginTop: 16 }}
        />
      ) : null}
    </Screen>
  );
}

// ── Output & input: clipboard, spacing, haptics ────────────────────────────────
export function OutputSettings() {
  const { pop } = useNav();
  const { settings, updateSettings } = useStore();

  return (
    <Screen title="Output & input" subtitle="What happens after you speak & type" onBack={pop}>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="clipboard-outline"
          tint={Colors.success}
          label="Auto-copy after dictation"
          subtitle="Copy the result to the clipboard"
          value={settings.autoCopy}
          onValueChange={(v) => updateSettings({ autoCopy: v })}
        />
        <Divider />
        <ToggleRow
          icon="code-outline"
          tint="#9AA5B1"
          label="Add trailing space"
          subtitle="End each dictation with a space"
          value={settings.trailingSpace}
          onValueChange={(v) => updateSettings({ trailingSpace: v })}
        />
        <Divider />
        <ToggleRow
          icon="radio-outline"
          tint="#FF6B9D"
          label="Haptic feedback"
          subtitle="A tap on key presses & actions"
          value={settings.haptics}
          onValueChange={(v) => updateSettings({ haptics: v })}
        />
      </Card>
    </Screen>
  );
}

// ── Personal dictionary: snippets, vocabulary, corrections ─────────────────────
export function DictionarySettings() {
  const { pop, push } = useNav();
  const { snippets, vocabulary, corrections } = useStore();

  return (
    <Screen title="Personal dictionary" subtitle="Teach VibeFlow your words" onBack={pop}>
      <Card padded={false} style={styles.group}>
        <NavRow
          icon="albums-outline"
          tint={Colors.brand}
          label="Snippets"
          subtitle="Say a trigger, insert a phrase"
          value={String(snippets.length)}
          onPress={() => push('snippets')}
        />
        <Divider />
        <NavRow
          icon="book-outline"
          tint="#54A0FF"
          label="Vocabulary"
          subtitle="Names & terms to spell right"
          value={String(vocabulary.length)}
          onPress={() => push('vocabulary')}
        />
        <Divider />
        <NavRow
          icon="swap-horizontal-outline"
          tint="#32D4C8"
          label="Corrections"
          subtitle="Auto-fix ‘heard → meant’"
          value={String(corrections.length)}
          onPress={() => push('corrections')}
        />
      </Card>
    </Screen>
  );
}

// ── Appearance: theme ──────────────────────────────────────────────────────────
export function AppearanceSettings() {
  const { pop } = useNav();
  const [themePref, setThemePref] = useState<'system' | 'dark' | 'light'>(() => {
    const v = prefGet('app_theme') ?? getItem('app_theme');
    return v === 'dark' || v === 'light' ? v : 'system';
  });
  const applyTheme = (v: 'system' | 'dark' | 'light') => {
    if (v === themePref) return;
    haptic.tap();
    setThemePref(v);
    if (v === 'system') {
      prefRemove('app_theme');
      try { removeItem('app_theme'); } catch {}
    } else {
      prefSet('app_theme', v);
      try { setItem('app_theme', v); } catch {}
    }
    setTimeout(() => Updates.reloadAsync().catch(() => {}), 150);
  };

  return (
    <Screen title="Appearance" subtitle="Theme" onBack={pop}>
      <Card style={styles.segCard}>
        <View style={styles.segRow}>
          {(
            [
              { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
              { key: 'dark', label: 'Dark', icon: 'moon-outline' },
              { key: 'light', label: 'Light', icon: 'sunny-outline' },
            ] as const
          ).map((opt) => {
            const active = themePref === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => applyTheme(opt.key)}
                style={({ pressed }) => [styles.seg, active && styles.segActive, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name={opt.icon} size={16} color={active ? Colors.onBrand : Colors.inkSoft} />
                <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.segHint}>Switching restarts the app for an instant re-theme.</Text>
      </Card>
    </Screen>
  );
}

// ── About & privacy: about, replay demo, delete account ────────────────────────
export function AboutSettings() {
  const { pop, push } = useNav();
  const { replayDemo } = useStore();
  const { signedIn } = useAuth();
  const [busy, setBusy] = useState(false);

  const confirmDeleteAccount = () => {
    if (busy) return;
    haptic.warning();
    Alert.alert(
      'Delete account?',
      "This permanently deletes your VibeFlow account and all your data — profile, usage history and device list. This can't be undone.\n\nIf you have a paid subscription, cancel it separately in the App Store or Play Store; deleting your account here doesn't cancel it.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAccount();
              haptic.success();
              Alert.alert('Account deleted', 'Your account and data have been removed.');
            } catch (e: any) {
              haptic.warning();
              Alert.alert("Couldn't delete account", e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen title="About & privacy" onBack={pop}>
      <Card padded={false} style={styles.group}>
        <NavRow
          icon="information-circle-outline"
          tint="#9AA5B1"
          label="About VibeFlow"
          onPress={() => push('about')}
        />
        <Divider />
        <NavRow
          icon="sparkles-outline"
          tint={Colors.brand}
          label="Replay welcome demo"
          onPress={() => {
            haptic.tap();
            replayDemo();
          }}
        />
      </Card>

      {signedIn ? (
        <View style={styles.deleteZone}>
          <Pressable
            disabled={busy}
            onPress={confirmDeleteAccount}
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="trash-outline" size={15} color={Colors.accentRed} />
            <Text style={styles.deleteText}>Delete account</Text>
          </Pressable>
          <Text style={styles.deleteNote}>Permanently erases your account and data.</Text>
        </View>
      ) : null}
    </Screen>
  );
}

// ── Shared: the language bottom sheet (moved out of the old Settings screen) ────
function LanguageSheet({
  open,
  current,
  onClose,
  onPick,
}: {
  open: boolean;
  current: string;
  onClose: () => void;
  onPick: (code: string) => void;
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <Text style={[Type.title, styles.sheetTitle]}>Language</Text>
          <Text style={[Type.bodySoft, { marginBottom: 6 }]}>
            Pick the language VibeFlow recognises on-device.
          </Text>
          <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
            {LANGUAGES.map((lang) => {
              const selected = lang.code === current;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => onPick(lang.code)}
                  style={({ pressed }) => [
                    styles.langRow,
                    selected && styles.langRowSelected,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[Type.body, selected && { fontWeight: '700' }]}>{lang.label}</Text>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={20} color={Colors.brand} />
                  ) : (
                    <Text style={styles.langCode}>{lang.code}</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  group: { paddingHorizontal: 16 },
  explain: { color: Colors.inkFaint, fontSize: 12.5, lineHeight: 18, marginTop: 4, paddingHorizontal: 4 },

  segCard: { gap: 10 },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 999, backgroundColor: Colors.chipBg,
    borderWidth: 1, borderColor: 'transparent',
  },
  segActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  segText: { color: Colors.inkSoft, fontSize: 13.5, fontWeight: '600' },
  segTextActive: { color: Colors.onBrand },
  segHint: { color: Colors.inkFaint, fontSize: 11.5 },

  deleteZone: { alignItems: 'center', marginTop: 30, marginBottom: 8 },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,90,90,0.28)', backgroundColor: 'rgba(255,90,90,0.06)',
  },
  deleteText: { color: Colors.accentRed, fontSize: 13.5, fontWeight: '600' },
  deleteNote: { color: Colors.inkSoft, opacity: 0.6, fontSize: 11.5, marginTop: 8, textAlign: 'center' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: Colors.outline,
    paddingHorizontal: Spacing.gutter, paddingTop: 10, paddingBottom: 32, maxHeight: '78%',
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: Colors.outline, marginBottom: 14 },
  sheetTitle: { fontSize: 22, marginBottom: 2 },
  sheetList: { marginTop: 8 },
  langRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, marginBottom: 6,
    backgroundColor: Colors.surfaceVariant, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent',
  },
  langRowSelected: { borderColor: Colors.brand, backgroundColor: `${Colors.brand}29` },
  langCode: { color: Colors.inkFaint, fontSize: 13, fontWeight: '600' },
});
