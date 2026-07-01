/**
 * Keyboard setup — the one-time onboarding that turns VibeFlow into a real iOS
 * keyboard. iOS custom keyboards must be enabled by the user in the Settings
 * app, so we can't do it for them; instead we walk them through it with calm,
 * numbered steps and a single tap that jumps straight into iOS Settings.
 *
 * The privacy angle is front and centre: VibeFlow needs NO "Full Access"
 * because the app and the keyboard extension share data through a private App
 * Group, never the system pasteboard.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { useNav } from '@/navigation/nav';
import { Colors, Radius } from '@/theme/colors';
import { Card, PrimaryButton, Screen, Type } from '@/ui/kit';

export function KeyboardSetupScreen() {
  const { pop } = useNav();

  const openSettings = () => {
    Linking.openSettings().catch(() => {});
  };

  return (
    <Screen title="Set up the keyboard" subtitle="Two minutes, one time" onBack={pop}>
      {/* The numbered walkthrough — one premium card per step. */}
      <View style={styles.steps}>
        <Step n={1}>Open the iOS Settings app.</Step>
        <Step n={2}>
          Go to <Text style={styles.path}>General → Keyboard → Keyboards</Text>.
        </Step>
        <Step n={3}>
          Tap <Text style={styles.path}>“Add New Keyboard…”</Text> and choose{' '}
          <Text style={styles.path}>VibeFlow</Text>.
        </Step>
        <Step n={4} tone="done">
          That’s it — VibeFlow needs{' '}
          <Text style={styles.strong}>no “Full Access”</Text>. Your words are shared
          privately through an App Group, never the pasteboard.
        </Step>
      </View>

      {/* Highlighted card: how the app and keyboard work together day to day. */}
      <Card style={styles.flowCard}>
        <View style={styles.flowHeader}>
          <View style={styles.flowBadge}>
            <Ionicons name="sparkles" size={16} color={Colors.brand} />
          </View>
          <Text style={styles.flowTitle}>Your daily flow</Text>
        </View>

        <FlowStep
          icon="mic-outline"
          text="Dictate in the VibeFlow app — your words are formatted instantly."
        />
        <FlowConnector />
        <FlowStep
          icon="globe-outline"
          text="In any app, switch to the VibeFlow keyboard with the 🌐 globe key."
        />
        <FlowConnector />
        <FlowStep
          icon="arrow-down-circle-outline"
          text="Tap “Insert latest” to drop them right at the cursor."
        />
      </Card>

      <PrimaryButton
        label="Open iOS Settings"
        icon="settings-outline"
        onPress={openSettings}
        style={styles.cta}
      />

      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={16} color={Colors.inkFaint} />
        <Text style={styles.noteText}>
          Don’t see VibeFlow in the list? Make sure the app finished installing, then
          reopen Settings.
        </Text>
      </View>
    </Screen>
  );
}

// --- a single numbered step --------------------------------------------------

function Step({
  n,
  children,
  tone = 'default',
}: {
  n: number;
  children: React.ReactNode;
  tone?: 'default' | 'done';
}) {
  const done = tone === 'done';
  return (
    <Card style={styles.stepCard}>
      <View style={[styles.stepNum, done && styles.stepNumDone]}>
        {done ? (
          <Ionicons name="checkmark" size={18} color="#fff" />
        ) : (
          <Text style={styles.stepNumText}>{n}</Text>
        )}
      </View>
      <Text style={styles.stepText}>{children}</Text>
    </Card>
  );
}

// --- the "daily flow" mini-steps inside the highlighted card -----------------

function FlowStep({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.flowStep}>
      <View style={styles.flowIcon}>
        <Ionicons name={icon} size={18} color={Colors.brand} />
      </View>
      <Text style={styles.flowText}>{text}</Text>
    </View>
  );
}

function FlowConnector() {
  return (
    <View style={styles.connectorWrap}>
      <View style={styles.connectorLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  steps: { gap: 12 },

  stepCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepNum: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.brand,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  stepNumDone: { backgroundColor: Colors.success, shadowColor: Colors.success },
  stepNumText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  stepText: { ...Type.body, flex: 1 },
  path: { color: Colors.ink, fontWeight: '700' },
  strong: { color: Colors.success, fontWeight: '800' },

  flowCard: {
    marginTop: 22,
    backgroundColor: 'rgba(124,92,255,0.08)',
    borderColor: 'rgba(124,92,255,0.35)',
  },
  flowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  flowBadge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(124,92,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowTitle: { color: Colors.ink, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },

  flowStep: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flowIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.chip,
    backgroundColor: 'rgba(124,92,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowText: { ...Type.bodySoft, color: Colors.inkSoft, flex: 1 },

  connectorWrap: { paddingLeft: 17, height: 18, justifyContent: 'center' },
  connectorLine: {
    width: StyleSheet.hairlineWidth * 2,
    height: 18,
    backgroundColor: 'rgba(124,92,255,0.4)',
  },

  cta: { marginTop: 24 },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 2,
  },
  noteText: { ...Type.bodySoft, color: Colors.inkFaint, flex: 1 },
});
