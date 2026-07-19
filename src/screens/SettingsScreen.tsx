/**
 * Settings — the top-level control room. Instead of one long scroll of every knob,
 * this is now a short MENU: the Pro banner + account stay pinned on top, and each
 * group (Recognition, Formatting, Output, …) is a row that opens its own focused
 * detail screen (see SettingsDetail.tsx). Nothing was removed — just regrouped.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { PRO_ENABLED } from '@/config/features';
import { useAuth } from '@/hooks/useAuth';
import { signInWithApple, signInWithGoogle, signOut } from '@/services/auth';
import { fetchQuota, quotaLabel, Quota } from '@/services/quota';
import { useNav } from '@/navigation/nav';
import { useStore } from '@/store';
import { getItem } from '@/store/appGroup';
import { prefGet } from '@/store/prefs';
// True only in a build that actually bundles the Android IME native module — keeps the
// Keyboard row hidden on Android builds that don't have the keyboard yet.
import { isAvailable as androidKeyboardAvailable } from '@/services/keyboard';
import { Colors, Radius } from '@/theme/colors';
import { Card, Divider, NavRow, Screen, Type, haptic } from '@/ui/kit';

export function SettingsScreen() {
  const { premium } = useStore();
  const { push } = useNav();
  const { signedIn, email } = useAuth();
  const [authBusy, setAuthBusy] = useState(false);
  // Live "N free left" readout — RLS read, consumes nothing.
  const [quota, setQuota] = useState<Quota | null>(null);
  useEffect(() => {
    if (!signedIn) {
      setQuota(null);
      return;
    }
    let alive = true;
    fetchQuota().then((q) => alive && setQuota(q));
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const runAuth = (fn: () => Promise<void>) => async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await fn();
      haptic.success();
    } catch (e: any) {
      haptic.warning();
      const msg = e?.message ?? e?.error_description ?? String(e);
      if (!/cancell?ed|1001/i.test(msg)) Alert.alert('Sign-in failed', msg);
    } finally {
      setAuthBusy(false);
    }
  };

  // Subscriptions can only be cancelled through the store — deep-link straight to it.
  const openManageSubscription = () => {
    const url =
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions?sku=vibeflow_pro&package=com.vibeflow.mobile';
    haptic.tap();
    Linking.openURL(url).catch(() => {});
  };

  // Current theme, shown as the value on the Appearance row (detail owns the control).
  const themeLabel = (() => {
    const v = prefGet('app_theme') ?? getItem('app_theme');
    return v === 'dark' ? 'Dark' : v === 'light' ? 'Light' : 'System';
  })();

  const go = (route: Parameters<typeof push>[0]) => () => {
    haptic.tap();
    push(route);
  };

  const showKeyboard = Platform.OS === 'ios' || androidKeyboardAvailable;

  return (
    <Screen title="Settings" subtitle="Tune how VibeFlow listens and writes.">
      {/* Pro upsell — only when the user hasn't unlocked it yet. */}
      {PRO_ENABLED && !premium ? (
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
                  <Text style={styles.goldSub}>Smart AI formatting, unlimited snippets & more.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#E8C96A" />
              </View>
            </View>
          </LinearGradient>
        </Pressable>
      ) : null}

      {/* Account — pinned at the top of the menu. */}
      <Card style={{ gap: 12, marginTop: 4 }}>
        {signedIn ? (
          <>
            <View style={styles.acctRow}>
              <View style={styles.acctIcon}>
                <Ionicons name="person" size={18} color={Colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={Type.label}>{email ?? 'Signed in'}</Text>
                <Text style={[Type.bodySoft, { marginTop: 2 }]}>{quotaLabel(quota)}</Text>
              </View>
            </View>
            {premium ? (
              <NavRow
                icon="card-outline"
                label="Manage subscription"
                subtitle={Platform.OS === 'ios' ? 'Change or cancel in the App Store' : 'Change or cancel in Google Play'}
                onPress={openManageSubscription}
              />
            ) : null}
            <View style={styles.acctActions}>
              <Pressable disabled={authBusy} onPress={runAuth(signOut)} style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.6 }]}>
                <Ionicons name="log-out-outline" size={17} color={Colors.inkSoft} />
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={Type.bodySoft}>
              Sign in to unlock 50 free AI polishes a week — grammar, punctuation and
              formatting, powered by VibeFlow's cloud.
            </Text>
            {Platform.OS === 'ios' ? (
              <Pressable disabled={authBusy} onPress={runAuth(signInWithApple)} style={({ pressed }) => [styles.appleBtn, pressed && { opacity: 0.85 }]}>
                <Ionicons name="logo-apple" size={18} color="#000" />
                <Text style={styles.appleBtnText}>Continue with Apple</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={authBusy}
              onPress={runAuth(signInWithGoogle)}
              style={({ pressed }) => [Platform.OS === 'ios' ? styles.googleBtn : styles.appleBtn, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="logo-google" size={16} color={Platform.OS === 'ios' ? Colors.ink : '#000'} />
              <Text style={Platform.OS === 'ios' ? styles.googleBtnText : styles.appleBtnText}>Continue with Google</Text>
            </Pressable>
          </>
        )}
      </Card>

      {/* The knobs — each opens its own focused screen. */}
      <Card padded={false} style={styles.menu}>
        <NavRow
          icon="mic-outline"
          tint={Colors.brand}
          label="Recognition"
          subtitle="On-device mode · language · voice commands"
          onPress={go('settingsRecognition')}
        />
        <Divider />
        <NavRow
          icon="color-wand-outline"
          tint="#56B6FF"
          label="Formatting"
          subtitle="Punctuation, capitalization, cleanup"
          onPress={go('settingsFormatting')}
        />
        <Divider />
        <NavRow
          icon="sparkles-outline"
          tint={Colors.amber}
          label="Smart formatting"
          subtitle="AI grammar & tone · Pro"
          onPress={go('settingsSmartFormat')}
        />
        <Divider />
        <NavRow
          icon="swap-horizontal-outline"
          tint={Colors.success}
          label="Output & input"
          subtitle="Auto-copy, spacing, haptics"
          onPress={go('settingsOutput')}
        />
      </Card>

      <Card padded={false} style={styles.menu}>
        <NavRow
          icon="book-outline"
          tint="#A855F7"
          label="Personal dictionary"
          subtitle="Snippets · vocabulary · corrections"
          onPress={go('settingsDictionary')}
        />
        <Divider />
        <NavRow
          icon="contrast-outline"
          tint="#9AA5B1"
          label="Appearance"
          value={themeLabel}
          onPress={go('settingsAppearance')}
        />
        {showKeyboard ? (
          <>
            <Divider />
            <NavRow
              icon="keypad-outline"
              tint="#5FA8FF"
              label="Keyboard"
              subtitle="Set up VibeFlow in any app"
              onPress={go('keyboardSetup')}
            />
          </>
        ) : null}
        <Divider />
        <NavRow
          icon="information-circle-outline"
          tint="#8E8CF0"
          label="About & privacy"
          subtitle="Version, privacy, replay demo"
          onPress={go('settingsAbout')}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  goldEdge: { borderRadius: Radius.card + 1.5, padding: 1.5, marginBottom: 4 },
  goldCard: { backgroundColor: '#1A1406', borderRadius: Radius.card, padding: 14 },
  goldIcon: {
    width: 40, height: 40, borderRadius: 13, backgroundColor: '#F2CA52',
    alignItems: 'center', justifyContent: 'center',
  },
  goldTitle: { color: '#FFE9A8', fontSize: 15.5, fontWeight: '800' },
  goldSub: { color: 'rgba(255,233,168,0.7)', fontSize: 12.5, marginTop: 2 },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bannerText: { flex: 1 },

  menu: { paddingHorizontal: 16, marginTop: 16 },

  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  acctIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: `${Colors.brand}26`,
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
  acctActions: { gap: 4 },
  signOutBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 6, paddingHorizontal: 2 },
  signOutText: { color: Colors.inkSoft, fontSize: 14, fontWeight: '600' },
});
