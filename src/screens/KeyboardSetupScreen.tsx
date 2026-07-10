/**
 * Keyboard setup — a *guided, self-verifying* onboarding. iOS won't let the app
 * enable the keyboard for you, so we walk you through it and confirm each step
 * live: the keyboard extension reports (via the App Group) that it has run and
 * whether it has Full Access, and this screen polls those flags so the checkmarks
 * light up as you go.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { useNav } from '@/navigation/nav';
import { getItem } from '@/store/appGroup';
import * as Keyboard from '@/services/keyboard';
import { Colors, Radius } from '@/theme/colors';
import { Card, GhostButton, PrimaryButton, Screen, Type, haptic } from '@/ui/kit';

export function KeyboardSetupScreen() {
  // Android has a real IME (the vibeflow-keyboard native module); iOS uses the
  // App Group-backed extension flow below.
  if (Platform.OS === 'android') return <AndroidKeyboardSetup />;
  return <IOSKeyboardSetup />;
}

// ── Android: enable the InputMethodService, then switch to it ────────────────────
function AndroidKeyboardSetup() {
  const { pop } = useNav();
  const [enabled, setEnabled] = useState(false);
  const [chosen, setChosen] = useState(false);
  const wasDone = useRef(false);

  const readState = useCallback(() => {
    const en = Keyboard.isEnabled();
    const ch = Keyboard.isChosen();
    setEnabled(en);
    setChosen(ch);
    if (en && ch && !wasDone.current) {
      wasDone.current = true;
      haptic.success();
    }
  }, []);

  useEffect(() => {
    readState();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') readState();
    });
    const timer = setInterval(readState, 1200);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [readState]);

  const done = enabled && chosen;

  return (
    <Screen title="Set up the keyboard" subtitle="Type by voice in any app" onBack={pop}>
      {done ? (
        <Card style={styles.successCard}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={40} color={Colors.success} />
          </View>
          <Text style={[Type.title, { fontSize: 22, marginTop: 10 }]}>You're all set 🎉</Text>
          <Text style={[Type.bodySoft, { textAlign: 'center', marginTop: 6 }]}>
            The VibeFlow keyboard is on. In any app, tap the keyboard-switch key (🌐) to pick VibeFlow,
            then tap the mic and speak.
          </Text>
          <PrimaryButton label="Done" icon="checkmark" onPress={pop} style={{ marginTop: 18 }} />
        </Card>
      ) : (
        <>
          <StepRow
            index={1}
            done={enabled}
            title="Turn on the VibeFlow keyboard"
            subtitle="Languages & input → On-screen keyboard → Manage keyboards → enable VibeFlow."
          />
          <PrimaryButton
            label="Open keyboard settings"
            icon="settings-outline"
            onPress={() => {
              haptic.tap();
              Keyboard.openImeSettings();
            }}
            style={{ marginTop: 8 }}
          />

          <StepRow
            index={2}
            done={chosen}
            active={enabled}
            title="Switch to VibeFlow"
            subtitle="Tap below, then use the switcher to choose VibeFlow. You'll see the mic keyboard."
          />
          <GhostButton
            label="Switch keyboard now"
            icon="swap-horizontal"
            onPress={() => {
              haptic.tap();
              Keyboard.openImePicker();
            }}
            style={{ marginTop: 6 }}
          />

          <Text style={[Type.caption, { marginTop: 26 }]}>TRY IT</Text>
          <Card style={{ marginTop: 8 }}>
            <Text style={[Type.bodySoft, { marginBottom: 10 }]}>
              Tap here, switch to VibeFlow with the 🌐 key, and tap the mic — your words appear as you speak.
            </Text>
            <TextInput
              placeholder="Tap and dictate with VibeFlow…"
              placeholderTextColor={Colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.probe}
            />
            <View style={styles.statusRow}>
              <Dot on={enabled} label="Enabled" />
              <Dot on={chosen} label="Selected" />
            </View>
          </Card>

          <GhostButton label="I'll do this later" onPress={pop} style={{ marginTop: 16 }} />
        </>
      )}
    </Screen>
  );
}

// ── iOS: App Group-backed keyboard-extension flow ───────────────────────────────
function IOSKeyboardSetup() {
  const { pop } = useNav();

  const [installed, setInstalled] = useState(false);
  const [fullAccess, setFullAccess] = useState(false);
  const [probe, setProbe] = useState('');
  const wasDone = useRef(false);

  const readState = useCallback(() => {
    const inst = getItem('kbd_installed') === 'true';
    const fa = getItem('kbd_full_access') === 'true';
    setInstalled(inst);
    setFullAccess(fa);
    if (inst && fa && !wasDone.current) {
      wasDone.current = true;
      haptic.success();
    }
  }, []);

  // Poll while on screen + refresh whenever the app returns from Settings.
  useEffect(() => {
    readState();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') readState();
    });
    const timer = setInterval(readState, 1200);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [readState]);

  const openSettings = () => {
    haptic.tap();
    Linking.openSettings().catch(() => {});
  };

  const done = installed && fullAccess;

  return (
    <Screen title="Set up the keyboard" subtitle="I'll confirm each step as you go" onBack={pop}>
      {done ? (
        <Card style={styles.successCard}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={40} color={Colors.success} />
          </View>
          <Text style={[Type.title, { fontSize: 22, marginTop: 10 }]}>You're all set 🎉</Text>
          <Text style={[Type.bodySoft, { textAlign: 'center', marginTop: 6 }]}>
            The VibeFlow keyboard is enabled with Full Access. Tap the 🌐 globe in any app to switch
            to it, then tap the mic to dictate.
          </Text>
          <PrimaryButton label="Done" icon="checkmark" onPress={pop} style={{ marginTop: 18 }} />
        </Card>
      ) : (
        <>
          <StepRow
            index={1}
            done={installed}
            title="Add the VibeFlow keyboard"
            subtitle="Settings → General → Keyboard → Keyboards → Add New Keyboard → VibeFlow"
          />
          <StepRow
            index={2}
            done={fullAccess}
            active={installed}
            title="Turn on Allow Full Access"
            subtitle="Tap VibeFlow in that list → toggle Allow Full Access → Allow. This lets the mic open VibeFlow to dictate."
          />

          <PrimaryButton
            label="Open iOS Settings"
            icon="settings-outline"
            onPress={openSettings}
            style={{ marginTop: 20 }}
          />

          {/* Verify: typing here with the VibeFlow keyboard makes the extension run,
              which reports its state back so the checks above update. */}
          <Text style={[Type.caption, { marginTop: 26 }]}>VERIFY</Text>
          <Card style={{ marginTop: 8 }}>
            <Text style={[Type.bodySoft, { marginBottom: 10 }]}>
              Tap below, switch to the VibeFlow keyboard with the 🌐 globe key, and type a letter —
              the checkmarks above will light up automatically.
            </Text>
            <TextInput
              value={probe}
              onChangeText={setProbe}
              placeholder="Type here with VibeFlow…"
              placeholderTextColor={Colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.probe}
            />
            <View style={styles.statusRow}>
              <Dot on={installed} label="Keyboard active" />
              <Dot on={fullAccess} label="Full Access" />
            </View>
          </Card>

          <GhostButton label="I'll do this later" onPress={pop} style={{ marginTop: 16 }} />
        </>
      )}
    </Screen>
  );
}

function StepRow({
  index,
  title,
  subtitle,
  done,
  active = true,
}: {
  index: number;
  title: string;
  subtitle: string;
  done: boolean;
  active?: boolean;
}) {
  return (
    <Card style={[styles.step, !active && !done && { opacity: 0.55 }]}>
      <View style={[styles.badge, done && styles.badgeDone]}>
        {done ? (
          <Ionicons name="checkmark" size={20} color="#fff" />
        ) : (
          <Text style={styles.badgeText}>{index}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={Type.label}>{title}</Text>
        <Text style={[Type.bodySoft, { marginTop: 3 }]}>{subtitle}</Text>
      </View>
    </Card>
  );
}

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <View style={styles.dotWrap}>
      <View style={[styles.dot, { backgroundColor: on ? Colors.success : Colors.outline }]} />
      <Text style={[Type.bodySoft, { color: on ? Colors.ink : Colors.inkFaint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 12 },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDone: { backgroundColor: Colors.success },
  badgeText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  probe: {
    backgroundColor: Colors.surfaceVariant,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.ink,
    fontSize: 16,
  },
  statusRow: { flexDirection: 'row', gap: 20, marginTop: 14 },
  dotWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  successCard: { alignItems: 'center', marginTop: 8 },
  successIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(67,230,193,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
