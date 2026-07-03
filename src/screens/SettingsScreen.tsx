/**
 * Settings — the control room. Every knob VibeFlow exposes lives here, grouped
 * into calm, scannable cards (Recognition, Formatting, Output, Smart formatting,
 * Personalise, Keyboard, About) so the long list never feels heavy.
 *
 * Recognition + formatting toggles write straight into the store; the language
 * picker is an in-place bottom sheet; Smart formatting is gated behind Pro.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import * as Updates from 'expo-updates';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CurationOptions } from '@/core';
import { useAuth } from '@/hooks/useAuth';
import { signInWithApple, signInWithGoogle, signOut } from '@/services/auth';
import { useNav } from '@/navigation/nav';
import { LANGUAGES, languageLabel, useStore } from '@/store';
import { getItem, removeItem, setItem } from '@/store/appGroup';
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
  const { signedIn, email } = useAuth();
  const [authBusy, setAuthBusy] = useState(false);
  const runAuth = (fn: () => Promise<void>) => async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await fn();
      haptic.success();
    } catch (e: any) {
      haptic.warning();
      // Surface the REAL failure — a silent catch here hid a failed token exchange
      // behind a successful-looking Apple sheet.
      const msg = e?.message ?? e?.error_description ?? String(e);
      if (!/cancell?ed|1001/i.test(msg)) Alert.alert('Sign-in failed', msg);
    } finally {
      setAuthBusy(false);
    }
  };
  // Appearance: explicit choice persisted in the App Group; styles resolve at JS
  // launch, so applying re-themes via an instant reload.
  const [themePref, setThemePref] = useState<'system' | 'dark' | 'light'>(() => {
    try {
      const v = getItem('app_theme');
      return v === 'dark' || v === 'light' ? v : 'system';
    } catch {
      return 'system';
    }
  });
  const applyTheme = (v: 'system' | 'dark' | 'light') => {
    if (v === themePref) return;
    haptic.tap();
    setThemePref(v);
    try {
      if (v === 'system') removeItem('app_theme');
      else setItem('app_theme', v);
    } catch {}
    setTimeout(() => Updates.reloadAsync().catch(() => {}), 150);
  };

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
    if (v && !signedIn) {
      haptic.warning();
      // The free tier needs an account (50 polishes/week ride the backend quota).
      return;
    }
    updateSettings({ smartFormat: v });
  };

  return (
    <Screen title="Settings" subtitle="Tune how VibeFlow listens and writes.">
      {/* Pro upsell — only when the user hasn't unlocked it yet. */}
      {!premium ? (
        <Pressable onPress={() => push('paywall')} style={({ pressed }) => [pressed && { opacity: 0.9 }]}>
          <LinearGradient
            colors={['#F7D774', '#D4A017', '#FFE9A8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.goldEdge}
          >
            <View style={styles.goldCard}>
              <View style={styles.bannerRow}>
                <View style={styles.goldIcon}>
                  <Ionicons name="sparkles" size={20} color="#3A2A00" />
                </View>
                <View style={styles.bannerText}>
                  <Text style={styles.goldTitle}>Unlock VibeFlow Pro</Text>
                  <Text style={styles.goldSub}>Smart AI formatting, unlimited snippets &amp; more.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#E8C96A" />
              </View>
            </View>
          </LinearGradient>
        </Pressable>
      ) : null}

      {/* Account & AI ----------------------------------------------------------- */}
      <SectionTitle>Account &amp; AI</SectionTitle>
      <Card style={{ gap: 12 }}>
        {signedIn ? (
          <>
            <View style={styles.acctRow}>
              <View style={styles.acctIcon}>
                <Ionicons name="person" size={18} color={Colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={Type.label}>{email ?? 'Signed in'}</Text>
                <Text style={[Type.bodySoft, { marginTop: 2 }]}>
                  50 free AI polishes / week · Pro = unlimited
                </Text>
              </View>
            </View>
            <Pressable onPress={runAuth(signOut)} style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.7 }]}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={Type.bodySoft}>
              Sign in to unlock 50 free AI polishes a week — grammar, punctuation and
              formatting, powered by VibeFlow's cloud.
            </Text>
            <Pressable disabled={authBusy} onPress={runAuth(signInWithApple)} style={({ pressed }) => [styles.appleBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="logo-apple" size={18} color="#000" />
              <Text style={styles.appleBtnText}>Continue with Apple</Text>
            </Pressable>
            <Pressable disabled={authBusy} onPress={runAuth(signInWithGoogle)} style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="logo-google" size={16} color={Colors.ink} />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </Pressable>
          </>
        )}
      </Card>

      {/* Appearance ------------------------------------------------------------ */}
      <SectionTitle>Appearance</SectionTitle>
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
                <Ionicons name={opt.icon} size={16} color={active ? '#fff' : Colors.inkSoft} />
                <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.segHint}>Switching restarts the app for an instant re-theme.</Text>
      </Card>

      {/* Recognition ---------------------------------------------------------- */}
      <SectionTitle>Recognition</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="shield-checkmark-outline"
          tint="#39D98A"
          label="On-device only"
          subtitle="Your voice never leaves this phone"
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

      {/* Formatting ----------------------------------------------------------- */}
      <SectionTitle>Formatting</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="chatbox-ellipses-outline"
          tint="#7C5CFF"
          label="Spoken punctuation"
          subtitle="Say ‘comma’, ‘period’, ‘question mark’"
          value={settings.curation.spokenPunctuation}
          onValueChange={(v) => setCuration({ spokenPunctuation: v })}
        />
        <Divider />
        <ToggleRow
          icon="return-down-back-outline"
          tint="#32D4C8"
          label="Layout commands"
          subtitle="‘new line’, ‘new paragraph’"
          value={settings.curation.spokenCommands}
          onValueChange={(v) => setCuration({ spokenCommands: v })}
        />
        <Divider />
        <ToggleRow
          icon="text-outline"
          tint="#FF9F0A"
          label="Capitalise sentences"
          value={settings.curation.capitalizeSentences}
          onValueChange={(v) => setCuration({ capitalizeSentences: v })}
        />
        <Divider />
        <ToggleRow
          icon="chevron-up-circle-outline"
          tint="#FFB84D"
          label="Capitalise first letter"
          value={settings.curation.capitalizeFirst}
          onValueChange={(v) => setCuration({ capitalizeFirst: v })}
        />
        <Divider />
        <ToggleRow
          icon="person-outline"
          tint="#FFD60A"
          label="Fix ‘i’ → ‘I’"
          value={settings.curation.fixPronounI}
          onValueChange={(v) => setCuration({ fixPronounI: v })}
        />
        <Divider />
        <ToggleRow
          icon="sparkles-outline"
          tint="#FF6B9D"
          label="Remove fillers"
          subtitle="Drop ‘um’, ‘uh’…"
          value={settings.curation.stripFillers}
          onValueChange={(v) => setCuration({ stripFillers: v })}
        />
        <Divider />
        <ToggleRow
          icon="ellipse-outline"
          tint="#8E8CF0"
          label="Auto end period"
          value={settings.curation.autoPeriod}
          onValueChange={(v) => setCuration({ autoPeriod: v })}
        />
        <Divider />
        <ToggleRow
          icon="copy-outline"
          tint="#4DC4FF"
          label="Collapse repeats"
          value={settings.curation.dedupeRepeats}
          onValueChange={(v) => setCuration({ dedupeRepeats: v })}
        />
      </Card>

      {/* Output & input ------------------------------------------------------- */}
      <SectionTitle>Output &amp; input</SectionTitle>
      <Card padded={false} style={styles.group}>
        <ToggleRow
          icon="clipboard-outline"
          tint="#39D98A"
          label="Auto-copy after dictation"
          value={settings.autoCopy}
          onValueChange={(v) => updateSettings({ autoCopy: v })}
        />
        <Divider />
        <ToggleRow
          icon="code-outline"
          tint="#9AA5B1"
          label="Add trailing space"
          value={settings.trailingSpace}
          onValueChange={(v) => updateSettings({ trailingSpace: v })}
        />
        <Divider />
        <ToggleRow
          icon="mic-outline"
          tint="#FF7A6B"
          label="Voice editing commands"
          subtitle="‘scratch that’, ‘delete last word’"
          value={settings.voiceCommands}
          onValueChange={(v) => updateSettings({ voiceCommands: v })}
        />
        <Divider />
        <ToggleRow
          icon="radio-outline"
          tint="#FF6B9D"
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
          subtitle={signedIn ? "AI cleans grammar &amp; tone — 50 free/week" : "Sign in above to enable"}
          value={signedIn ? settings.smartFormat : false}
          onValueChange={onToggleSmart}
        />
      </Card>

      {/* Personalise ---------------------------------------------------------- */}
      <SectionTitle>Personalise</SectionTitle>
      <Card padded={false} style={styles.group}>
        <NavRow
          icon="albums-outline"
          tint="#7C5CFF"
          label="Snippets"
          value={String(snippets.length)}
          onPress={() => push('snippets')}
        />
        <Divider />
        <NavRow
          icon="book-outline"
          tint="#54A0FF"
          label="Vocabulary"
          value={String(vocabulary.length)}
          onPress={() => push('vocabulary')}
        />
        <Divider />
        <NavRow
          icon="swap-horizontal-outline"
          tint="#32D4C8"
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
          tint="#39D98A"
          label="Set up the keyboard"
          subtitle="Guided: add VibeFlow + Allow Full Access"
          onPress={() => push('keyboardSetup')}
        />
      </Card>

      {/* About ---------------------------------------------------------------- */}
      <SectionTitle>About</SectionTitle>
      <Card padded={false} style={styles.group}>
        <NavRow
          icon="information-circle-outline"
          tint="#9AA5B1"
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
  goldEdge: { borderRadius: Radius.card + 1.5, padding: 1.5, marginBottom: 4 },
  goldCard: { backgroundColor: '#1A1406', borderRadius: Radius.card, padding: 14 },
  goldIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#F2CA52',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldTitle: { color: '#FFE9A8', fontSize: 15.5, fontWeight: '800' },
  goldSub: { color: 'rgba(255,233,168,0.7)', fontSize: 12.5, marginTop: 2 },
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

  segCard: { gap: 10 },

  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  acctIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  appleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 999, paddingVertical: 13,
  },
  appleBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.chipBg, borderRadius: 999, paddingVertical: 13,
    borderWidth: 1, borderColor: Colors.outline,
  },
  googleBtnText: { color: Colors.ink, fontSize: 15, fontWeight: '600' },
  signOutBtn: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 2 },
  signOutText: { color: Colors.accentRed, fontSize: 13.5, fontWeight: '600' },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.chipBg,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  segText: { color: Colors.inkSoft, fontSize: 13.5, fontWeight: '600' },
  segTextActive: { color: '#fff' },
  segHint: { color: Colors.inkFaint, fontSize: 11.5 },

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
