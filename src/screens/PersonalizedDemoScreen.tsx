/**
 * First-run personalised demo — the activation "aha" moment.
 *
 * Flow (a small in-screen state machine, shown once, gated by store.demoCompleted):
 *   1. profile  — capture the user's name + job title (name prefilled from sign-in).
 *   2. read     — show a short message written *as if from them* and have them read
 *                 it aloud. The recognizer is PRIMED with name+title (contextualStrings
 *                 → SFSpeechRecognizer) so those are heard correctly, and both are saved
 *                 to Vocabulary so they're never misheard again (keyboard included).
 *   3. result   — their RAW dictation (what Free gives) beside the VibeFlow Pro polish
 *                 (real AI if signed in, a representative preview otherwise) → "Unlock Pro".
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/hooks/useAuth';
import { useDictation } from '@/hooks/useDictation';
import { useNav } from '@/navigation/nav';
import { signInWithApple, signInWithGoogle } from '@/services/auth';
import { polish } from '@/services/polish';
import { useStore } from '@/store';
import { Colors, Radius, Spacing, brandGradient, heroMicGradient } from '@/theme/colors';
import { Card, GhostButton, PrimaryButton, Screen, TextField, Type, haptic } from '@/ui/kit';

// ── personalised copy ────────────────────────────────────────────────────────
/** The message the user reads aloud — realistic, punctuation-rich, name+role embedded. */
function buildSample(name: string, role: string): string {
  const who = [name, role].filter(Boolean).join(', ');
  const intro = who ? `Hi, this is ${who}.` : 'Hi there.';
  return (
    `${intro} I wanted to follow up on yesterday's conversation about the Q3 launch plan. ` +
    `Could you send over the revised budget by Thursday and loop in the design team so we can ` +
    `lock the timeline? I'd also like to set up a quick 30 minute sync early next week to review ` +
    `the final numbers. Thanks so much for your help on this, and let me know if anything is unclear.`
  );
}

/** A representative "what Pro produces" preview, used when a live polish isn't available. */
function buildCannedAfter(name: string): string {
  const sign = name ? `\n\nBest,\n${name}` : '';
  return (
    `Hi team,\n\n` +
    `Following up on yesterday's conversation about the Q3 launch plan:\n\n` +
    `• Please send over the revised budget by Thursday.\n` +
    `• Loop in the design team so we can lock the timeline.\n\n` +
    `I'd also like to set up a quick 30‑minute sync early next week to review the final numbers.\n\n` +
    `Thanks so much for your help — let me know if anything's unclear.${sign}`
  );
}

type Step = 'signin' | 'profile' | 'read' | 'result';

export function PersonalizedDemoScreen() {
  const { setProfile, addTerm, completeDemo, settings, profile } = useStore();
  const { push } = useNav();
  const { session, signedIn, ready } = useAuth();

  const meta: any = session?.user?.user_metadata ?? {};
  const [step, setStep] = useState<Step>('signin');
  const [name, setName] = useState(profile.name || meta.full_name || meta.name || '');
  const [role, setRole] = useState(profile.jobTitle || '');
  const [raw, setRaw] = useState('');
  const [after, setAfter] = useState('');
  const [afterKind, setAfterKind] = useState<'real' | 'canned'>('canned');
  const [polishing, setPolishing] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  // Already signed in when the demo opens? Skip straight past the sign-in step.
  useEffect(() => {
    if (step === 'signin' && ready && signedIn) setStep('profile');
  }, [step, ready, signedIn]);

  // Prefill the name from the provider once a session lands (if still blank).
  useEffect(() => {
    const fromProvider = meta.full_name || meta.name;
    if (fromProvider && !name.trim()) setName(String(fromProvider));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.full_name, meta.name]);

  const runAuth = (fn: () => Promise<void>) => async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await fn();
      haptic.success();
      setStep('profile');
    } catch (e: any) {
      haptic.warning();
      const msg = e?.message ?? String(e);
      if (!/cancell?ed|1001/i.test(msg)) Alert.alert('Sign-in failed', msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const sample = useMemo(() => buildSample(name.trim(), role.trim()), [name, role]);

  const dictation = useDictation({
    lang: settings.language,
    onDeviceOnly: settings.onDeviceOnly,
    // Prime the recognizer with the name (full + parts) and role.
    contextualStrings: [name.trim(), role.trim(), ...name.trim().split(/\s+/)].filter(Boolean),
    onFinal: (text) => {
      const t = text.trim();
      if (t.length < 4) return; // didn't catch anything — let them try again
      setRaw(t);
      setStep('result');
      runPolish(t);
    },
  });
  const listening = dictation.state === 'listening';

  async function runPolish(text: string) {
    setPolishing(true);
    const r = await polish(text, 'auto');
    if (r.ok && r.text) {
      setAfter(r.text);
      setAfterKind('real');
    } else {
      setAfter(buildCannedAfter(name.trim()));
      setAfterKind('canned');
    }
    setPolishing(false);
  }

  // Persist profile + seed vocabulary the moment they commit to the demo.
  function prime() {
    setProfile({ name: name.trim(), jobTitle: role.trim() });
    if (name.trim()) addTerm(name.trim());
    if (role.trim()) addTerm(role.trim());
  }

  function toRead() {
    prime();
    haptic.tap();
    setStep('read');
  }

  function finish(toPaywall: boolean) {
    prime();
    if (toPaywall) push('paywall');
    completeDemo();
  }

  async function signInAndPolish() {
    try {
      await signInWithApple();
      haptic.success();
      if (raw) runPolish(raw);
    } catch {
      haptic.warning();
    }
  }

  // ── step 0: sign in (skippable) ────────────────────────────────────────────
  if (step === 'signin') {
    return (
      <Screen>
        <View style={styles.hero}>
          <LinearGradient colors={[...brandGradient]} style={styles.heroIcon}>
            <Ionicons name="mic" size={26} color="#fff" />
          </LinearGradient>
          <Text style={Type.title}>Welcome to VibeFlow</Text>
          <Text style={[Type.subtitle, { marginTop: 6 }]}>
            Sign in to sync across your devices and get <Text style={{ color: Colors.ink, fontWeight: '700' }}>50 free AI polishes a week</Text> — so we can show you the real magic on your own words.
          </Text>
        </View>

        <Pressable disabled={authBusy} onPress={runAuth(signInWithApple)} style={({ pressed }) => [styles.appleBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="logo-apple" size={19} color="#000" />
          <Text style={styles.appleBtnText}>Continue with Apple</Text>
        </Pressable>
        <Pressable disabled={authBusy} onPress={runAuth(signInWithGoogle)} style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="logo-google" size={17} color={Colors.ink} />
          <Text style={styles.googleBtnText}>Continue with Google</Text>
        </Pressable>

        {authBusy ? <ActivityIndicator style={{ marginTop: 16 }} color={Colors.brand} /> : null}

        <GhostButton label="Skip for now" onPress={() => { haptic.tap(); setStep('profile'); }} style={{ marginTop: 12 }} />
        <Text style={styles.skipNote}>
          You can still try the demo — signing in just lets Pro polish your actual recording.
        </Text>
      </Screen>
    );
  }

  // ── step 1: profile ────────────────────────────────────────────────────────
  if (step === 'profile') {
    return (
      <Screen>
        <View style={styles.hero}>
          <LinearGradient colors={[...brandGradient]} style={styles.heroIcon}>
            <Ionicons name="sparkles" size={26} color="#fff" />
          </LinearGradient>
          <Text style={Type.title}>Let's make this yours</Text>
          <Text style={[Type.subtitle, { marginTop: 6 }]}>
            Tell us who you are — VibeFlow will teach the recognizer your name so it's never
            misheard, and tailor a quick 15‑second demo.
          </Text>
        </View>

        <Card style={{ gap: 16 }}>
          <TextField label="Your name" value={name} onChangeText={setName} placeholder="Alex Rivera" autoCapitalize="words" autoFocus />
          <TextField label="Job title" value={role} onChangeText={setRole} placeholder="Product Manager" autoCapitalize="words" />
        </Card>

        <View style={{ height: 20 }} />
        <PrimaryButton label="Start the demo" icon="arrow-forward" onPress={toRead} disabled={!name.trim()} />
        <GhostButton label="Skip for now" onPress={() => finish(false)} style={{ marginTop: 6 }} />
      </Screen>
    );
  }

  // ── step 2: read aloud ─────────────────────────────────────────────────────
  if (step === 'read') {
    return (
      <Screen>
        <View style={styles.hero}>
          <Text style={Type.title}>Read this out loud</Text>
          <Text style={[Type.subtitle, { marginTop: 6 }]}>
            Tap the mic and read it naturally — just like you'd dictate a real message.
          </Text>
        </View>

        <Card style={{ gap: 0 }}>
          <Text style={styles.sample}>{sample}</Text>
        </Card>

        {listening ? (
          <Text style={styles.live} numberOfLines={3}>
            {dictation.transcript || 'Listening…'}
          </Text>
        ) : (
          <Text style={styles.hint}>
            Your name + title are primed, so they'll come through right.
          </Text>
        )}

        <View style={styles.micWrap}>
          <MicOrb listening={listening} level={dictation.level} onPress={() => {
            if (listening) dictation.stop();
            else dictation.start();
          }} />
          <Text style={styles.micLabel}>{listening ? 'Tap to finish' : 'Tap to speak'}</Text>
        </View>

        <GhostButton label="Skip" onPress={() => finish(false)} />
      </Screen>
    );
  }

  // ── step 3: before vs after ────────────────────────────────────────────────
  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={Type.title}>Here's the difference</Text>
        <Text style={[Type.subtitle, { marginTop: 6 }]}>
          Same words. This is what Pro's AI polish adds on top of free dictation.
        </Text>
      </View>

      {/* BEFORE — raw dictation (free) */}
      <View style={styles.resultLabelRow}>
        <Ionicons name="mic-outline" size={15} color={Colors.inkSoft} />
        <Text style={styles.resultLabel}>FREE · your raw dictation</Text>
      </View>
      <Card style={{ marginBottom: 16 }}>
        <Text style={styles.beforeText}>{raw}</Text>
      </Card>

      {/* AFTER — Pro polish */}
      <View style={styles.resultLabelRow}>
        <Ionicons name="sparkles" size={15} color={Colors.amber} />
        <Text style={[styles.resultLabel, { color: Colors.amber }]}>
          VIBEFLOW PRO · polished{afterKind === 'canned' ? ' (preview)' : ''}
        </Text>
      </View>
      <LinearGradient colors={['#F7D774', '#D4A017']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.proEdge}>
        <View style={styles.proInner}>
          {polishing ? (
            <View style={styles.polishing}>
              <ActivityIndicator color={Colors.amber} />
              <Text style={{ color: Colors.inkSoft }}>Polishing…</Text>
            </View>
          ) : (
            <Text style={styles.afterText}>{after}</Text>
          )}
        </View>
      </LinearGradient>

      {afterKind === 'canned' && !signedIn ? (
        <Pressable onPress={signInAndPolish} style={styles.signInNudge}>
          <Ionicons name="logo-apple" size={15} color={Colors.ink} />
          <Text style={styles.signInNudgeText}>Sign in to polish your own words</Text>
        </Pressable>
      ) : null}

      <View style={{ height: 22 }} />
      <PrimaryButton label="Unlock VibeFlow Pro" icon="sparkles" onPress={() => finish(true)} />
      <GhostButton label="Continue to the app" onPress={() => finish(false)} style={{ marginTop: 6 }} />
    </Screen>
  );
}

// ── mic orb (compact, self-contained) ────────────────────────────────────────
function MicOrb({ listening, level, onPress }: { listening: boolean; level: number; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5 + level * 0.5] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <View style={styles.orbArea}>
      {listening ? (
        <Animated.View
          style={[styles.orbRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
        />
      ) : null}
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={listening ? 'Stop' : 'Start'}>
        <LinearGradient
          colors={listening ? ['#E54749', '#FF7A6B'] : [...heroMicGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.orb}
        >
          <Ionicons name={listening ? 'stop' : 'mic'} size={40} color="#fff" />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: 22 },
  heroIcon: {
    width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  sample: { color: Colors.ink, fontSize: 17, lineHeight: 27, fontWeight: '500' },
  hint: { color: Colors.inkFaint, fontSize: 13, textAlign: 'center', marginTop: 18 },
  live: { color: Colors.inkSoft, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 18, minHeight: 44 },

  micWrap: { alignItems: 'center', marginTop: 20, marginBottom: 24, gap: 10 },
  micLabel: { color: Colors.inkSoft, fontSize: 13, fontWeight: '600' },
  orbArea: { alignItems: 'center', justifyContent: 'center', width: 140, height: 140 },
  orbRing: { position: 'absolute', width: 104, height: 104, borderRadius: 52, backgroundColor: '#7C5CFF' },
  orb: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center' },

  resultLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  resultLabel: { color: Colors.inkSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  beforeText: { color: Colors.inkSoft, fontSize: 15, lineHeight: 23 },
  proEdge: { borderRadius: Radius.card + 2, padding: 2 },
  proInner: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: 16 },
  afterText: { color: Colors.ink, fontSize: 15, lineHeight: 24, fontWeight: '500' },
  polishing: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },

  signInNudge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  signInNudgeText: { color: Colors.ink, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },

  appleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14, backgroundColor: '#fff', marginBottom: 10,
  },
  appleBtnText: { color: '#000', fontSize: 16, fontWeight: '600' },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14, backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.outline,
  },
  googleBtnText: { color: Colors.ink, fontSize: 16, fontWeight: '600' },
  skipNote: { color: Colors.inkFaint, fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 17 },
});

