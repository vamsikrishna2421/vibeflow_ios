/**
 * First-run personalised demo — the activation "aha" moment.
 *
 * Flow (one-time, gated by store.demoCompleted):
 *   0. signin      — Apple/Google, skippable (a session lets Pro polish real words).
 *   1. profile     — capture name + job title (name prefilled from sign-in).
 *   2. permissions — explicit up-front mic + speech ask (the mic-tap ask remains too).
 *   3. read        — read a personalised brain-dump aloud. The recognizer is PRIMED
 *                    with name+title (contextualStrings → SFSpeechRecognizer) so they're
 *                    heard right, and both are saved to Vocabulary (keyboard included).
 *   4. result      — the RAW dictation, then the SAME words transformed three ways —
 *                    Email · Casual · Notes (facts/to-dos/follow-ups/open questions) —
 *                    to show Pro's range. Real polish() when signed in, crafted preview
 *                    otherwise. → "Unlock Pro".
 */
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/hooks/useAuth';
import { useDictation } from '@/hooks/useDictation';
import { useNav } from '@/navigation/nav';
import { signInWithApple, signInWithGoogle } from '@/services/auth';
import { polish, PolishStyle } from '@/services/polish';
import { useStore } from '@/store';
import { Colors, Radius, brandGradient, heroMicGradient } from '@/theme/colors';
import { Card, GhostButton, PrimaryButton, Screen, TextField, Type, haptic } from '@/ui/kit';

// The showcase styles (a subset of PolishStyle) + their tab presentation.
type Style = 'email' | 'message' | 'notes' | 'plan';
const STYLES: { key: Style; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'email', label: 'Email', icon: 'mail-outline' },
  { key: 'message', label: 'Casual', icon: 'chatbubble-ellipses-outline' },
  { key: 'notes', label: 'Notes', icon: 'list-outline' },
  { key: 'plan', label: 'Plan', icon: 'checkmark-done-outline' },
];

// ── personalised copy ────────────────────────────────────────────────────────
/** A natural brain-dump the user reads aloud — deliberately rambling so the three
 *  transformations (formal email / casual chat / structured notes) all land. */
function buildSample(name: string, role: string): string {
  const who = [name, role].filter(Boolean).join(', ');
  const intro = who ? `This is ${who}, just capturing a few quick thoughts before I forget.` : 'Just capturing a few quick thoughts before I forget.';
  return (
    `${intro} We need to finalize the Q3 budget by Thursday — I think we're running about ` +
    `fifteen percent over right now. Remind me to loop in the design team about the new timeline, ` +
    `and did marketing ever confirm the launch date? Also, the vendor contract renews next month, ` +
    `so someone should review that. I'm feeling good about the roadmap overall, but the numbers need another look.`
  );
}

/** Crafted "what Pro produces" preview for each style — used when a live polish
 *  isn't available (not signed in / offline / quota). Guarantees the format lands. */
function cannedFor(style: Style, name: string): string {
  const sign = name ? `\n\nBest,\n${name}` : '';
  if (style === 'email') {
    return (
      `Subject: Q3 Roadmap — budget, timeline & open items\n\n` +
      `Hi team,\n\n` +
      `A few quick items before they slip:\n` +
      `• Finalize the Q3 budget by Thursday — we're ~15% over, so it needs another look.\n` +
      `• I'll loop in the design team on the new timeline.\n` +
      `• Can someone confirm whether marketing locked the launch date?\n` +
      `• The vendor contract renews next month — let's review it beforehand.\n\n` +
      `Feeling good about the roadmap overall; just want the numbers tightened.${sign}`
    );
  }
  if (style === 'message') {
    return (
      `Hey! Quick brain-dump 🧠\n\n` +
      `• Q3 budget's due Thursday, we're ~15% over 😬\n` +
      `• I'll pull in design on the timeline\n` +
      `• Did marketing ever lock the launch date?\n` +
      `• Heads up — vendor contract renews next month, needs a review\n\n` +
      `Roadmap's looking good, just gotta fix the numbers 👍`
    );
  }
  if (style === 'notes') {
    // Plain, scannable bullet points — quick jottings, no categories.
    return (
      `• Finalize the Q3 budget by Thursday — we're ~15% over.\n` +
      `• Loop in the design team on the new timeline.\n` +
      `• Confirm whether marketing locked the launch date.\n` +
      `• Vendor contract renews next month — needs a review.\n` +
      `• Roadmap looks good overall; the numbers need another look.`
    );
  }
  // plan — action-focused: to-dos / follow-ups / open questions
  return (
    `✅ TO-DOS\n` +
    `• Finalize the Q3 budget by Thursday (~15% over).\n` +
    `• Loop in the design team on the new timeline.\n\n` +
    `🔁 FOLLOW-UPS\n` +
    `• Review the vendor contract before it renews next month.\n\n` +
    `❓ OPEN QUESTIONS\n` +
    `• Did marketing confirm the launch date?`
  );
}

type Step = 'signin' | 'profile' | 'permissions' | 'read' | 'result';
interface Output {
  text: string;
  kind: 'real' | 'canned';
  loading: boolean;
}

export function PersonalizedDemoScreen() {
  const { setProfile, addTerm, completeDemo, settings, profile } = useStore();
  const { push } = useNav();
  const { session, signedIn, ready } = useAuth();

  const meta: any = session?.user?.user_metadata ?? {};
  const [step, setStep] = useState<Step>('signin');
  const [name, setName] = useState(profile.name || meta.full_name || meta.name || '');
  const [role, setRole] = useState(profile.jobTitle || '');
  const [raw, setRaw] = useState('');
  const [activeStyle, setActiveStyle] = useState<Style>('email');
  const [outputs, setOutputs] = useState<Partial<Record<Style, Output>>>({});
  const [authBusy, setAuthBusy] = useState(false);
  // Which style tabs the user has opened — drives the "tap me" hint + pulse so
  // nobody misses that Casual/Notes are tappable. 'email' is the default tab.
  const [viewedStyles, setViewedStyles] = useState<Set<Style>>(() => new Set<Style>(['email']));
  const [copied, setCopied] = useState(false);

  const sample = useMemo(() => buildSample(name.trim(), role.trim()), [name, role]);

  // Already signed in when the demo opens? Skip past the sign-in step.
  useEffect(() => {
    if (step === 'signin' && ready && signedIn) setStep('profile');
  }, [step, ready, signedIn]);

  // Prefill name from the provider once a session lands (if still blank).
  useEffect(() => {
    const fromProvider = meta.full_name || meta.name;
    if (fromProvider && !name.trim()) setName(String(fromProvider));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.full_name, meta.name]);

  const dictation = useDictation({
    lang: settings.language,
    onDeviceOnly: settings.onDeviceOnly,
    contextualStrings: [name.trim(), role.trim(), ...name.trim().split(/\s+/)].filter(Boolean),
    onFinal: (text) => {
      const t = text.trim();
      if (t.length < 4) return; // didn't catch anything — let them try again
      setRaw(t);
      setOutputs({});
      setActiveStyle('email');
      setStep('result');
      // Eagerly polish the default (email) tab — but a beat AFTER the screen
      // transition + audio-session teardown settle. Firing the first network call
      // mid-transition is what could stall it; the spinner shows during this wait,
      // so the small defer is invisible. (Timeout + retry in polishStyle back it up.)
      setTimeout(() => polishStyle('email', t), 500);
    },
  });
  const listening = dictation.state === 'listening';

  // Pulse the not-yet-opened style tabs so nobody misses that Casual/Notes are tappable.
  const tabPulse = useRef(new Animated.Value(0)).current;
  const allStylesViewed = viewedStyles.size >= STYLES.length;
  useEffect(() => {
    if (allStylesViewed) {
      tabPulse.stopAnimation();
      tabPulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tabPulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(tabPulse, { toValue: 0, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [allStylesViewed, tabPulse]);

  async function polishStyle(style: Style, text: string) {
    setOutputs((o) => ({ ...o, [style]: { text: '', kind: 'canned', loading: true } }));
    // A THROWN or STALLED polish() must never leave the tab stuck on "Polishing…".
    // Each attempt is bounded (12s); we retry ONCE on a transient network/timeout blip —
    // the eagerly-fired first request (email) is the one prone to stalling mid-transition —
    // then fall back to the crafted preview so every tab always resolves.
    const attempt = async () => {
      try {
        return await polish(text, style as PolishStyle, undefined, 12000);
      } catch {
        return null;
      }
    };
    let r = await attempt();
    if (r === null || (!r.ok && r.error === 'network')) r = await attempt();
    setOutputs((o) => ({
      ...o,
      [style]:
        r && r.ok && r.text
          ? { text: r.text, kind: 'real', loading: false }
          : { text: cannedFor(style, name.trim()), kind: 'canned', loading: false },
    }));
  }

  function selectStyle(s: Style) {
    haptic.tap();
    setActiveStyle(s);
    setViewedStyles((v) => new Set(v).add(s));
    setCopied(false);
    if (!outputs[s] && raw) polishStyle(s, raw);
  }

  // Copy the currently-shown polished text so it can be pasted straight into Gmail etc.
  async function copyResult() {
    const t = outputs[activeStyle]?.text;
    if (!t) return;
    try {
      await Clipboard.setStringAsync(t);
      haptic.success();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      haptic.warning();
    }
  }

  // Step back through the one-time demo flow (signin → profile → permissions → read → result).
  function back() {
    haptic.tap();
    if (step === 'result') setStep('read');
    else if (step === 'read') setStep('permissions');
    else if (step === 'permissions') setStep('profile');
    else if (step === 'profile') setStep('signin');
  }

  // Persist profile + seed vocabulary the moment they commit to the demo.
  function prime() {
    setProfile({ name: name.trim(), jobTitle: role.trim() });
    if (name.trim()) addTerm(name.trim());
    if (role.trim()) addTerm(role.trim());
  }

  function toPermissions() {
    prime();
    haptic.tap();
    setStep('permissions');
  }

  // Explicit up-front permission ask (mic + speech). We advance either way — the
  // mic-tap request in useDictation stays as the safety net if they defer here.
  async function requestPerms() {
    try {
      await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      haptic.success();
    } catch {
      // ignore — read step re-asks on the first mic tap
    }
    setStep('read');
  }

  function finish(toPaywall: boolean) {
    prime();
    if (toPaywall) push('paywall');
    completeDemo();
  }

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

  async function signInAndPolish() {
    try {
      // Apple sign-in only exists on iOS; Android uses the Google OAuth flow.
      if (Platform.OS === 'ios') await signInWithApple();
      else await signInWithGoogle();
      haptic.success();
      if (raw) polishStyle(activeStyle, raw); // re-polish current tab for real
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
            Sign in to sync across your devices and get{' '}
            <Text style={{ color: Colors.ink, fontWeight: '700' }}>50 free AI polishes a week</Text> — so we can show you the real magic on your own words.
          </Text>
        </View>

        {/* Apple sign-in is iOS-only: the native module doesn't exist on Android
            (the button would throw), and SIWA is an App Store rule, not a Play one. */}
        {Platform.OS === 'ios' ? (
          <Pressable disabled={authBusy} onPress={runAuth(signInWithApple)} style={({ pressed }) => [styles.appleBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="logo-apple" size={19} color="#000" />
            <Text style={styles.appleBtnText}>Continue with Apple</Text>
          </Pressable>
        ) : null}
        {/* On Android, Google is the only provider → give it the primary (white) look. */}
        <Pressable
          disabled={authBusy}
          onPress={runAuth(signInWithGoogle)}
          style={({ pressed }) => [Platform.OS === 'ios' ? styles.googleBtn : styles.appleBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="logo-google" size={17} color={Platform.OS === 'ios' ? Colors.ink : '#000'} />
          <Text style={Platform.OS === 'ios' ? styles.googleBtnText : styles.appleBtnText}>Continue with Google</Text>
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
            Tell us who you are — VibeFlow will teach the recognizer your name so it's never misheard, and tailor a quick demo.
          </Text>
        </View>

        <Card style={{ gap: 16 }}>
          <TextField label="Your name" value={name} onChangeText={setName} placeholder="Alex Rivera" autoCapitalize="words" autoFocus />
          <TextField label="Job title" value={role} onChangeText={setRole} placeholder="Product Manager" autoCapitalize="words" />
        </Card>

        <View style={{ height: 20 }} />
        <PrimaryButton label="Continue" icon="arrow-forward" onPress={toPermissions} disabled={!name.trim()} />
        <GhostButton label="Skip for now" onPress={() => finish(false)} style={{ marginTop: 6 }} />
      </Screen>
    );
  }

  // ── step 1.5: permissions (explicit, up-front) ─────────────────────────────
  if (step === 'permissions') {
    return (
      <Screen onBack={back}>
        <View style={styles.hero}>
          <LinearGradient colors={[...brandGradient]} style={styles.heroIcon}>
            <Ionicons name="mic" size={26} color="#fff" />
          </LinearGradient>
          <Text style={Type.title}>Enable your voice</Text>
          <Text style={[Type.subtitle, { marginTop: 6 }]}>
            VibeFlow turns speech into text{' '}
            <Text style={{ color: Colors.ink, fontWeight: '700' }}>on‑device</Text> — your voice never leaves your phone. We just need the microphone and speech recognition.
          </Text>
        </View>

        <Card style={{ gap: 16 }}>
          <PermRow icon="mic-outline" title="Microphone" sub="To hear you while you dictate." />
          <PermRow icon="chatbubble-ellipses-outline" title="Speech Recognition" sub="To turn what you say into text, on-device." />
        </Card>

        <View style={{ height: 20 }} />
        <PrimaryButton label="Allow microphone & speech" icon="shield-checkmark" onPress={requestPerms} />
        <GhostButton label="Not now" onPress={() => setStep('read')} style={{ marginTop: 6 }} />
      </Screen>
    );
  }

  // ── step 2: read aloud ─────────────────────────────────────────────────────
  if (step === 'read') {
    return (
      <Screen onBack={back}>
        <View style={[styles.hero, { marginBottom: 10 }]}>
          <Text style={Type.title}>Read this out loud</Text>
          <Text style={[Type.subtitle, { marginTop: 6 }]}>
            Tap the mic and read it naturally — just like you'd dictate a real message.
          </Text>
        </View>

        <Card>
          <Text style={styles.sample}>{sample}</Text>
        </Card>

        {listening ? (
          <Text style={styles.live} numberOfLines={3}>
            {dictation.transcript || 'Listening…'}
          </Text>
        ) : (
          <Text style={styles.hint}>Your name + title are primed, so they'll come through right.</Text>
        )}

        <View style={styles.micWrap}>
          <MicOrb
            listening={listening}
            level={dictation.level}
            onPress={() => (listening ? dictation.stop() : dictation.start())}
          />
          <Text style={styles.micLabel}>{listening ? 'Tap to finish' : 'Tap to speak'}</Text>
        </View>

        <GhostButton label="Skip" onPress={() => finish(false)} />
      </Screen>
    );
  }

  // ── step 3: before → three transformations ─────────────────────────────────
  const out = outputs[activeStyle];
  return (
    <Screen onBack={back}>
      <View style={styles.hero}>
        <Text style={Type.title}>One voice note, three ways</Text>
        <Text style={[Type.subtitle, { marginTop: 6 }]}>
          Same words. Watch Pro reshape them for wherever they're going.
        </Text>
      </View>

      {/* BEFORE — raw dictation */}
      <View style={styles.resultLabelRow}>
        <Ionicons name="mic-outline" size={15} color={Colors.inkSoft} />
        <Text style={styles.resultLabel}>FREE · your raw dictation</Text>
      </View>
      <Card style={{ marginBottom: 18 }}>
        <Text style={styles.beforeText}>{raw}</Text>
      </Card>

      {/* style tabs */}
      <View style={styles.tabs}>
        {STYLES.map((s) => {
          const active = s.key === activeStyle;
          const unseen = !viewedStyles.has(s.key);
          return (
            <Pressable
              key={s.key}
              onPress={() => selectStyle(s.key)}
              style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name={s.icon} size={15} color={active ? '#fff' : Colors.inkSoft} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{s.label}</Text>
              {unseen ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.tabDot,
                    {
                      opacity: tabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
                      transform: [{ scale: tabPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) }],
                    },
                  ]}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {!allStylesViewed ? (
        <View style={styles.tabHintRow}>
          <Ionicons name="arrow-up" size={13} color={Colors.amber} />
          <Text style={styles.tabHint}>Tap the other styles — same words, reshaped for each</Text>
        </View>
      ) : null}

      {/* AFTER — polished for the selected style */}
      <View style={styles.resultLabelRow}>
        <Ionicons name="sparkles" size={15} color={Colors.amber} />
        <Text style={[styles.resultLabel, { color: Colors.amber }]}>
          VIBEFLOW PRO{out?.kind === 'canned' ? ' · preview' : ''}
        </Text>
      </View>
      <LinearGradient colors={['#F7D774', '#D4A017']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.proEdge}>
        <View style={styles.proInner}>
          {!out || out.loading ? (
            <View style={styles.polishing}>
              <ActivityIndicator color={Colors.amber} />
              <Text style={{ color: Colors.inkSoft }}>Polishing…</Text>
            </View>
          ) : (
            <Text style={styles.afterText}>{out.text}</Text>
          )}
        </View>
      </LinearGradient>

      {out && !out.loading ? (
        <Pressable onPress={copyResult} style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={17} color={copied ? Colors.amber : Colors.ink} />
          <Text style={styles.copyBtnText}>
            {copied ? 'Copied — paste it anywhere' : `Copy ${STYLES.find((s) => s.key === activeStyle)?.label ?? 'text'}`}
          </Text>
        </Pressable>
      ) : null}

      {out?.kind === 'canned' && !signedIn ? (
        <Pressable onPress={signInAndPolish} style={styles.signInNudge}>
          <Ionicons name={Platform.OS === 'ios' ? 'logo-apple' : 'logo-google'} size={15} color={Colors.ink} />
          <Text style={styles.signInNudgeText}>Sign in to polish your own words</Text>
        </Pressable>
      ) : null}

      <View style={{ height: 22 }} />
      <PrimaryButton label="Unlock VibeFlow Pro" icon="sparkles" onPress={() => finish(true)} />
      <GhostButton label="Continue to the app" onPress={() => finish(false)} style={{ marginTop: 6 }} />
    </Screen>
  );
}

// ── small helpers ─────────────────────────────────────────────────────────────
function PermRow({ icon, title, sub }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }) {
  return (
    <View style={styles.permRow}>
      <View style={styles.permIcon}>
        <Ionicons name={icon} size={18} color={Colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.permTitle}>{title}</Text>
        <Text style={styles.permSub}>{sub}</Text>
      </View>
    </View>
  );
}

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
        <Animated.View style={[styles.orbRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
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
  heroIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  sample: { color: Colors.ink, fontSize: 17, lineHeight: 27, fontWeight: '500' },
  hint: { color: Colors.inkFaint, fontSize: 13, textAlign: 'center', marginTop: 10 },
  live: { color: Colors.inkSoft, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 18, minHeight: 44 },

  micWrap: { alignItems: 'center', marginTop: 12, marginBottom: 14, gap: 8 },
  micLabel: { color: Colors.inkSoft, fontSize: 13, fontWeight: '600' },
  orbArea: { alignItems: 'center', justifyContent: 'center', width: 116, height: 116 },
  orbRing: { position: 'absolute', width: 92, height: 92, borderRadius: 46, backgroundColor: '#7C5CFF' },
  orb: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center' },

  permRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  permIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: Colors.chipBg, alignItems: 'center', justifyContent: 'center' },
  permTitle: { color: Colors.ink, fontSize: 15, fontWeight: '600' },
  permSub: { color: Colors.inkSoft, fontSize: 13, marginTop: 1 },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 40, borderRadius: 12, backgroundColor: Colors.chipBg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.outline,
  },
  tabActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  tabText: { color: Colors.inkSoft, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  tabDot: { position: 'absolute', top: 5, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.amber },
  tabHintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: -6, marginBottom: 14 },
  tabHint: { color: Colors.amber, fontSize: 12.5, fontWeight: '600' },

  resultLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  resultLabel: { color: Colors.inkSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  beforeText: { color: Colors.inkSoft, fontSize: 15, lineHeight: 23 },
  proEdge: { borderRadius: Radius.card + 2, padding: 2 },
  proInner: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: 16, minHeight: 80 },
  afterText: { color: Colors.ink, fontSize: 15, lineHeight: 24, fontWeight: '500' },
  polishing: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },

  copyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 44, marginTop: 12, borderRadius: 12, backgroundColor: Colors.chipBg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.outline,
  },
  copyBtnText: { color: Colors.ink, fontSize: 14, fontWeight: '700' },

  signInNudge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  signInNudgeText: { color: Colors.ink, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },

  appleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14, backgroundColor: '#fff', marginBottom: 10 },
  appleBtnText: { color: '#000', fontSize: 16, fontWeight: '600' },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.outline },
  googleBtnText: { color: Colors.ink, fontSize: 16, fontWeight: '600' },
  skipNote: { color: Colors.inkFaint, fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 17 },
});
