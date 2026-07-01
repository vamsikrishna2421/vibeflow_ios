/**
 * Settings — the control room. Every knob VibeFlow exposes lives here, grouped
 * into calm, scannable cards (Recognition, Formatting, Output, Smart formatting,
 * Personalise, Keyboard, About) so the long list never feels heavy.
 *
 * Recognition + formatting toggles write straight into the store; the language
 * picker is an in-place bottom sheet; Smart formatting is gated behind Pro.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CurationOptions } from '@/core';
import { useNav } from '@/navigation/nav';
import { LANGUAGES, languageLabel, useStore } from '@/store';
import { Colors, Radius, Spacing } from '@/theme/colors';
import {
  Badge,
  Card,
  Divider,
  NavRow,
  Screen,
  SectionTitle,
  ToggleRow,
  Type,
  haptic,
} from '@/ui/kit';

export function SettingsScreen() {
  const { settings, updateSettings, premium, snippets, vocabulary, corrections } = useStore();
  const { push } = useNav();
  const [langOpen, setLangOpen] = useState(false);

  // Patch a subset of the curation pipeline toggles in one shot.
  const setCuration = (patch: Partial<CurationOptions>) =>
    updateSettings({ curation: { ...settings.curation, ...patch } });

  const pickLanguage = (code: string) => {
    updateSettings({ language: code });
    haptic.tap();
    setLangOpen(false);
  };

  // Smart formatting is Pro-only: trying to enable it without Pro routes to the paywall.
  const onToggleSmart = (v: boolean) => {
    if (v && !premium) {
      haptic.warning();
      push('paywall');
      return;
    }
    updateSettings({ smartFormat: v });
  };

  return (
    <Screen title="Settings" subtitle="Tune how VibeFlow listens and writes.">
      {/* Pro upsell — only when the user hasn't unlocked it yet. */}
      {!premium ? (
        <Card style={styles.banner} onPress={() => push('paywall')}>
          <View style={styles.bannerRow}>
            <View style={styles.bannerIcon}>
              <Ionicons name="sparkles" size={22} color={Colors.brand} />
            </View>
            <View style={styles.bannerText}>
              <View style={styles.bannerTitleRow}>
                <Text style={Type.label}>Unlock VibeFlow Pro</Text>
                <Badge label="PRO" tone="amber" />
              </View>
              <Text style={[Type.bodySoft, { marginTop: 2 }]}>
                Smart AI formatting, unlimited snippets &amp; more.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.inkFaint} />
          </View>
        </Card>
      ) : null}

      {/* Recognition ---------------------------------------------------------- */}
      <SectionTitle>Recognition</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="shield-checkmark-outline"
          label="On-device only"
          subtitle="Your voice never leaves this phone"
          value={settings.onDeviceOnly}
          onValueChange={(v) => updateSettings({ onDeviceOnly: v })}
        />
        <Divider />
        <NavRow
          icon="language-outline"
          label="Language"
          value={languageLabel(settings.language)}
          onPress={() => setLangOpen(true)}
        />
      </Card>

      {/* Formatting ----------------------------------------------------------- */}
      <SectionTitle>Formatting</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          label="Spoken punctuation"
          subtitle="Say ‘comma’, ‘period’, ‘question mark’"
          value={settings.curation.spokenPunctuation}
          onValueChange={(v) => setCuration({ spokenPunctuation: v })}
        />
        <Divider />
        <ToggleRow
          label="Layout commands"
          subtitle="‘new line’, ‘new paragraph’"
          value={settings.curation.spokenCommands}
          onValueChange={(v) => setCuration({ spokenCommands: v })}
        />
        <Divider />
        <ToggleRow
          label="Capitalise sentences"
          value={settings.curation.capitalizeSentences}
          onValueChange={(v) => setCuration({ capitalizeSentences: v })}
        />
        <Divider />
        <ToggleRow
          label="Capitalise first letter"
          value={settings.curation.capitalizeFirst}
          onValueChange={(v) => setCuration({ capitalizeFirst: v })}
        />
        <Divider />
        <ToggleRow
          label="Fix ‘i’ → ‘I’"
          value={settings.curation.fixPronounI}
          onValueChange={(v) => setCuration({ fixPronounI: v })}
        />
        <Divider />
        <ToggleRow
          label="Remove fillers"
          subtitle="Drop ‘um’, ‘uh’…"
          value={settings.curation.stripFillers}
          onValueChange={(v) => setCuration({ stripFillers: v })}
        />
        <Divider />
        <ToggleRow
          label="Auto end period"
          value={settings.curation.autoPeriod}
          onValueChange={(v) => setCuration({ autoPeriod: v })}
        />
        <Divider />
        <ToggleRow
          label="Collapse repeats"
          value={settings.curation.dedupeRepeats}
          onValueChange={(v) => setCuration({ dedupeRepeats: v })}
        />
      </Card>

      {/* Output & input ------------------------------------------------------- */}
      <SectionTitle>Output &amp; input</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          label="Auto-copy after dictation"
          value={settings.autoCopy}
          onValueChange={(v) => updateSettings({ autoCopy: v })}
        />
        <Divider />
        <ToggleRow
          label="Add trailing space"
          value={settings.trailingSpace}
          onValueChange={(v) => updateSettings({ trailingSpace: v })}
        />
        <Divider />
        <ToggleRow
          label="Voice editing commands"
          subtitle="‘scratch that’, ‘delete last word’"
          value={settings.voiceCommands}
          onValueChange={(v) => updateSettings({ voiceCommands: v })}
        />
        <Divider />
        <ToggleRow
          label="Haptic feedback"
          value={settings.haptics}
          onValueChange={(v) => updateSettings({ haptics: v })}
        />
      </Card>

      {/* Smart formatting (Pro) ---------------------------------------------- */}
      <View style={styles.sectionRow}>
        <SectionTitle>Smart formatting</SectionTitle>
        <Badge label="PRO" tone="amber" />
      </View>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="color-wand-outline"
          label="Smart formatting"
          subtitle="AI cleans grammar &amp; tone (Pro)"
          value={premium ? settings.smartFormat : false}
          onValueChange={onToggleSmart}
        />
      </Card>

      {/* Personalise ---------------------------------------------------------- */}
      <SectionTitle>Personalise</SectionTitle>
      <Card padded={false} style={styles.group}>
        <NavRow
          icon="albums-outline"
          label="Snippets"
          value={String(snippets.length)}
          onPress={() => push('snippets')}
        />
        <Divider />
        <NavRow
          icon="book-outline"
          label="Vocabulary"
          value={String(vocabulary.length)}
          onPress={() => push('vocabulary')}
        />
        <Divider />
        <NavRow
          icon="swap-horizontal-outline"
          label="Corrections"
          value={String(corrections.length)}
          onPress={() => push('corrections')}
        />
      </Card>

      {/* Keyboard ------------------------------------------------------------- */}
      <SectionTitle>Keyboard</SectionTitle>
      <Card padded={false} style={styles.group}>
        <NavRow
          icon="keypad-outline"
          label="Set up the keyboard"
          subtitle="Enable VibeFlow — no Full Access needed"
          onPress={() => push('keyboardSetup')}
        />
      </Card>

      {/* About ---------------------------------------------------------------- */}
      <SectionTitle>About</SectionTitle>
      <Card padded={false} style={styles.group}>
        <NavRow
          icon="information-circle-outline"
          label="About VibeFlow"
          onPress={() => push('about')}
        />
      </Card>

      {/* Language picker bottom sheet ---------------------------------------- */}
      <Modal
        visible={langOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLangOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setLangOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={[Type.title, styles.sheetTitle]}>Language</Text>
            <Text style={[Type.bodySoft, { marginBottom: 6 }]}>
              Pick the language VibeFlow recognises on-device.
            </Text>
            <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
              {LANGUAGES.map((lang) => {
                const selected = lang.code === settings.language;
                return (
                  <Pressable
                    key={lang.code}
                    onPress={() => pickLanguage(lang.code)}
                    style={({ pressed }) => [
                      styles.langRow,
                      selected && styles.langRowSelected,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={[Type.body, selected && { fontWeight: '700' }]}>
                      {lang.label}
                    </Text>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(124,92,255,0.12)',
    borderColor: 'rgba(124,92,255,0.5)',
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(124,92,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: { flex: 1 },
  bannerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  group: { paddingHorizontal: 16 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outline,
    paddingHorizontal: Spacing.gutter,
    paddingTop: 10,
    paddingBottom: 32,
    maxHeight: '78%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.outline,
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 22, marginBottom: 2 },
  sheetList: { marginTop: 8 },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: Colors.surfaceVariant,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  langRowSelected: {
    borderColor: Colors.brand,
    backgroundColor: 'rgba(124,92,255,0.16)',
  },
  langCode: { color: Colors.inkFaint, fontSize: 13, fontWeight: '600' },
});
