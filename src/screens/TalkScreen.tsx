/**
 * Talk — the hero. Tap the mic, speak, and VibeFlow recognises it on-device,
 * runs the text pipeline (the same rules as Android), and builds a draft you can
 * copy or save. Saving makes it the "latest dictation" the keyboard inserts.
 *
 * iOS forbids recording inside a keyboard, so this is where capture happens; the
 * keyboard only inserts what we save here (via the App Group).
 */
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import { VoiceCommand } from '@/core';
import { useDictation } from '@/hooks/useDictation';
import { useNav } from '@/navigation/nav';
import { buildPipelineConfig, runDictation, useStore } from '@/store';
import { setItem } from '@/store/appGroup';
import { Colors, Radius, micGradient } from '@/theme/colors';
import { Badge, GhostButton, haptic } from '@/ui/kit';
import {
  addRecordToggleListener,
  flowSessionModuleAvailable,
  notifyResultReady,
  reassertFlowSession,
  startFlowSession,
  stopFlowSession,
} from '../../modules/vibeflow-flowsession';
import {
  liveActivityAvailable,
  startLiveActivity,
  stopLiveActivity,
  updateLiveActivity,
} from '../../modules/vibeflow-liveactivity';

const BAR_COUNT = 9;

export function TalkScreen() {
  const insets = useSafeAreaInsets();
  const { settings, snippets, vocabulary, corrections, addDictation } = useStore();
  const { recordNonce } = useNav();

  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const draftRef = useRef('');
  draftRef.current = draft;
  // True for the whole keyboard-initiated visit (vibeflow://record → until the app
  // backgrounds): every dictation in the visit is saved for the keyboard to type.
  const fromKeyboardRef = useRef(false);
  const [kbVisit, setKbVisit] = useState(false);
  // Flow Session: after that first hop we keep a background session alive (Dynamic
  // Island) so further keyboard mic taps record right here — no more app switches.
  const [sessionActive, setSessionActive] = useState(false);
  const sessionActiveRef = useRef(false);
  sessionActiveRef.current = sessionActive;
  // True while the current utterance was started by the keyboard over Darwin IPC.
  const flowUtteranceRef = useRef(false);

  const config = useMemo(
    () => buildPipelineConfig(settings, snippets, vocabulary, corrections),
    [settings, snippets, vocabulary, corrections],
  );

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  const handleFinal = useCallback(
    (raw: string) => {
      const outcome = runDictation(raw, settings, config);
      if (outcome.kind === 'command') {
        applyCommand(outcome.command);
        return;
      }
      if (!outcome.text) return;
      const next = draftRef.current ? draftRef.current + outcome.text : outcome.text;
      setDraft(next);
      if (settings.haptics) haptic.success();
      // Flow-session utterance (keyboard mic, app in background): hand ONLY this
      // utterance to the keyboard and ping it to insert immediately.
      if (flowUtteranceRef.current) {
        flowUtteranceRef.current = false;
        const text = outcome.text.trim();
        // Write synchronously BEFORE the Darwin ping — the store's App-Group mirror
        // runs in a later effect, and the keyboard reads the instant it's pinged.
        setItem('latest_dictation', text);
        setItem('latest_dictation_ts', String(Date.now()));
        addDictation(text);
        notifyResultReady();
        return;
      }
      // Keyboard-initiated visit: EVERY utterance (re)saves the accumulated draft,
      // stamped so the keyboard auto-types it on return — even if its process was
      // killed during the hop (the old in-memory handshake didn't survive that).
      if (fromKeyboardRef.current) {
        setItem('latest_dictation', next.trim());
        setItem('latest_dictation_ts', String(Date.now()));
        addDictation(next.trim());
        if (!sessionActiveRef.current) {
          const started = startFlowSession();
          if (!started) {
            // Audio session may still be tearing down right after recognition ends.
            setTimeout(() => {
              if (startFlowSession()) setSessionActive(true);
            }, 900);
          } else {
            setSessionActive(true);
          }
        }
        return;
      }
      if (settings.autoCopy) {
        Clipboard.setStringAsync(next.trim()).catch(() => {});
        flashToast('Copied — open any app and paste, or use the VibeFlow keyboard');
      }
    },
    // applyCommand defined below is stable via setDraft updater
    [settings, config, flashToast, addDictation],
  );

  const applyCommand = useCallback((command: VoiceCommand) => {
    setDraft((d) => {
      switch (command) {
        case VoiceCommand.DeleteLast:
          return '';
        case VoiceCommand.DeleteWord:
          return d.replace(/\s*\S+\s*$/, '');
        case VoiceCommand.NewLine:
          return d.replace(/\s+$/, '') + '\n';
        case VoiceCommand.NewParagraph:
          return d.replace(/\s+$/, '') + '\n\n';
        default:
          return d;
      }
    });
    haptic.medium();
  }, []);

  const dictation = useDictation({
    lang: settings.language,
    onDeviceOnly: settings.onDeviceOnly,
    onFinal: handleFinal,
  });
  const listening = dictation.state === 'listening';
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  // Keyboard mic tapped during an active Flow Session → start/stop an utterance
  // while we run in the background.
  useEffect(() => {
    const sub = addRecordToggleListener(() => {
      const d = dictationRef.current;
      if (d.state === 'listening') {
        d.stop();
      } else {
        flowUtteranceRef.current = true;
        d.start();
      }
    });
    return () => sub?.remove();
  }, []);

  // After each utterance ends, re-assert the keep-alive so iOS doesn't suspend us
  // between dictations (the speech lib can reconfigure the audio session on stop).
  useEffect(() => {
    if (!listening && sessionActive) reassertFlowSession();
  }, [listening, sessionActive]);

  const endSession = useCallback(() => {
    stopFlowSession();
    stopLiveActivity();
    setSessionActive(false);
    haptic.tap();
  }, []);

  // Keyboard deep-link (vibeflow://record) asks us to start immediately, and marks
  // this session as keyboard-initiated so we auto-save the result for the keyboard.
  // Keyboard mic → bootstrap hop. The product rule: you NEVER dictate inside
  // VibeFlow. This visit only (a) gets mic/speech permission, (b) turns the Flow
  // Session on, then tells you to go straight back — every utterance (including
  // the first) is spoken inside the host app via the keyboard mic. There is NO
  // record-here fallback anymore; if the engine can't start we say so and offer
  // Retry, with diagnostics.
  const [bootState, setBootState] = useState<'starting' | 'on' | 'failed'>('starting');
  const tryStartSession = useCallback(async () => {
    setBootState('starting');
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm?.granted) {
        setBootState('failed');
        return;
      }
    } catch {}
    let ok = startFlowSession();
    if (!ok) {
      // Audio session can need a beat on cold launch — retry once.
      await new Promise((r) => setTimeout(r, 800));
      ok = startFlowSession();
    }
    if (ok) {
      setSessionActive(true);
      setBootState('on');
    } else {
      setBootState('failed');
    }
  }, []);

  useEffect(() => {
    if (recordNonce > 0) {
      setKbVisit(true);
      tryStartSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordNonce]);

  // The keyboard-visit ends when the user returns to the host app. Also re-assert
  // the keep-alive right as we background — the speech lib may have reconfigured
  // the audio session, and this is the moment that decides if iOS keeps us alive.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') {
        fromKeyboardRef.current = false;
        setKbVisit(false);
        if (sessionActiveRef.current) reassertFlowSession();
      }
    });
    return () => sub.remove();
  }, []);

  // Live Activity (Dynamic Island): while dictating it shows "Listening…" with the
  // live transcript; while a Flow Session is idle it stays up as the session pill.
  useEffect(() => {
    if (listening) {
      startLiveActivity('Listening…');
    } else if (sessionActive) {
      startLiveActivity('Ready'); // no-op if already running
      updateLiveActivity('Ready — tap the mic on your keyboard', '');
    } else {
      stopLiveActivity();
    }
  }, [listening, sessionActive]);
  useEffect(() => {
    if (listening) updateLiveActivity('Listening…', dictation.partial);
  }, [dictation.partial, listening]);

  // Auto-dismiss the toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const toggle = () => {
    flowUtteranceRef.current = false; // manual tap → this is an in-app dictation
    if (listening) dictation.stop();
    else dictation.start();
  };

  const live = dictation.transcript;
  const showDraft = draft.length > 0;

  const onCopy = async () => {
    await Clipboard.setStringAsync(draft.trim());
    if (settings.haptics) haptic.success();
    flashToast('Copied to clipboard');
  };
  const onSave = () => {
    addDictation(draft.trim());
    if (settings.haptics) haptic.success();
    flashToast('Saved — tap "Insert latest" in the VibeFlow keyboard');
    setDraft('');
  };
  const onClear = () => {
    setDraft('');
    haptic.tap();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerRow}>
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>Vibe</Text>
          <Text style={[styles.wordmark, { color: Colors.brand }]}>Flow</Text>
        </View>
        <Badge label={settings.onDeviceOnly ? 'ON-DEVICE' : 'CLOUD'} tone={settings.onDeviceOnly ? 'brand' : 'amber'} />
      </View>

      {sessionActive ? (
        <View style={styles.sessionBar}>
          <View style={styles.sessionDot} />
          <Text style={styles.sessionText}>
            {liveActivityAvailable()
              ? 'Flow Session on — dictate from the keyboard mic, no switching'
              : 'Flow Session on. For the Dynamic Island pill, enable Live Activities: iOS Settings → VibeFlow'}
          </Text>
          <GhostButton label="End" tone="danger" onPress={endSession} />
        </View>
      ) : null}


      {kbVisit ? (
        // Bootstrap hero: you never dictate here — this screen only arms the
        // session and points you back to the app you came from.
        <View style={styles.center}>
          {bootState === 'on' ? (
            <>
              <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
              <Text style={styles.bootTitle}>You’re set — go back</Text>
              <Text style={styles.bootBig}>
                Tap <Text style={{ color: Colors.brand, fontWeight: '800' }}>‹ back</Text> in the{' '}
                <Text style={{ fontWeight: '800' }}>very top-left corner</Text> of the screen
              </Text>
              <Text style={styles.bootSub}>
                Then tap the 🎤 on the keyboard and speak right inside your app —
                while reading your messages. Your words appear where you type.
              </Text>
            </>
          ) : bootState === 'starting' ? (
            <>
              <Ionicons name="hourglass-outline" size={56} color={Colors.brand} />
              <Text style={styles.bootTitle}>Starting your Flow Session…</Text>
            </>
          ) : (
            <>
              <Ionicons name="alert-circle" size={56} color={Colors.accentRed} />
              <Text style={styles.bootTitle}>Couldn’t start the session</Text>
              <Text style={styles.bootSub}>
                engine {flowSessionModuleAvailable() ? '✓ loaded' : '✗ missing (update the app in TestFlight)'} ·
                island {liveActivityAvailable() ? '✓' : '✗ (Settings → VibeFlow → Live Activities)'}
              </Text>
              <Pressable onPress={tryStartSession} style={({ pressed }) => [styles.saveBtn, { alignSelf: 'stretch' }, pressed && { opacity: 0.9 }]}>
                <LinearGradient colors={[...micGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.saveGrad}>
                  <Ionicons name="refresh" size={18} color="#fff" />
                  <Text style={styles.saveText}>Try again</Text>
                </LinearGradient>
              </Pressable>
            </>
          )}
          <Pressable onPress={() => setKbVisit(false)} style={{ marginTop: 22 }}>
            <Text style={{ color: Colors.inkFaint, fontSize: 13 }}>Use the in-app mic instead</Text>
          </Pressable>
        </View>
      ) : (
      <View style={styles.center}>
        <Text style={styles.prompt}>
          {listening ? 'Listening…' : showDraft ? 'Tap to add more' : 'Tap to talk'}
        </Text>

        <MicButton listening={listening} level={dictation.level} onPress={toggle} />

        <Waveform listening={listening} level={dictation.level} />

        {dictation.error ? (
          <Text style={styles.error}>{dictation.error}</Text>
        ) : listening && live ? (
          <Text style={styles.live} numberOfLines={4}>
            {live}
          </Text>
        ) : (
          <Text style={styles.hint}>
            Speak naturally. Say “new line”, “comma”, or “question mark”. Say
            “scratch that” to undo.
          </Text>
        )}
      </View>
      )}

      {showDraft ? (
        <View style={styles.draftCard}>
          <Text style={styles.draftLabel}>DRAFT</Text>
          <Text style={styles.draftText}>{draft.trim()}</Text>
          <View style={styles.draftActions}>
            <GhostButton label="Copy" icon="copy-outline" onPress={onCopy} style={styles.flexBtn} />
            <GhostButton label="Clear" icon="trash-outline" tone="danger" onPress={onClear} style={styles.flexBtn} />
          </View>
          <Pressable onPress={onSave} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.9 }]}>
            <LinearGradient
              colors={[...micGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveGrad}
            >
              <Ionicons name="sparkles" size={18} color="#fff" />
              <Text style={styles.saveText}>Save for keyboard</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : (
        <View style={styles.steps}>
          <Step n="1" t="Dictate here — your words are formatted instantly." />
          <Step n="2" t="Switch to the VibeFlow keyboard (🌐 globe key) in any app." />
          <Step n="3" t="Tap “Insert latest” to drop them at the cursor." />
        </View>
      )}

      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + 16 }]}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text style={styles.toastText} numberOfLines={2}>
            {toast}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// --- mic button (pulse) ------------------------------------------------------

function MicButton({
  listening,
  level,
  onPress,
}: {
  listening: boolean;
  level: number;
  onPress: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (listening) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
  }, [listening, pulse]);

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1 + (listening ? level * 0.12 : 0),
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  }, [level, listening, scale]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View style={styles.micArea}>
      {listening ? (
        <Animated.View
          style={[styles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
        />
      ) : null}
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={listening ? 'Stop' : 'Start dictation'}>
          <LinearGradient
            colors={listening ? ['#E54749', '#FF7A6B'] : [...micGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.mic}
          >
            <Ionicons name={listening ? 'stop' : 'mic'} size={46} color="#fff" />
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// --- waveform ----------------------------------------------------------------

function Waveform({ listening, level }: { listening: boolean; level: number }) {
  const bars = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.2))).current;

  useEffect(() => {
    const target = listening ? Math.max(0.15, level) : 0.12;
    const animations = bars.map((bar, i) => {
      // give each bar a slightly different response so it looks alive
      const variance = 0.6 + 0.5 * Math.abs(Math.sin((i + 1) * 1.7));
      return Animated.timing(bar, {
        toValue: Math.min(1, target * variance + (listening ? 0.1 : 0)),
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      });
    });
    Animated.parallel(animations).start();
  }, [level, listening, bars]);

  return (
    <View style={styles.wave}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              height: bar.interpolate({ inputRange: [0, 1], outputRange: [6, 46] }),
              backgroundColor: listening ? Colors.brand : Colors.outline,
            },
          ]}
        />
      ))}
    </View>
  );
}

function Step({ n, t }: { n: string; t: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{t}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 22 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmarkRow: { flexDirection: 'row' },
  wordmark: { color: Colors.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  prompt: { color: Colors.ink, fontSize: 22, fontWeight: '700', marginBottom: 26 },

  sessionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.chip,
    backgroundColor: 'rgba(124,92,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(124,92,255,0.35)',
  },
  sessionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.brand },
  sessionText: { flex: 1, color: Colors.ink, fontSize: 12.5, lineHeight: 17 },

  bootTitle: { color: Colors.ink, fontSize: 24, fontWeight: '800', marginTop: 18, textAlign: 'center' },
  bootBig: { color: Colors.ink, fontSize: 20, lineHeight: 28, textAlign: 'center', marginTop: 14, paddingHorizontal: 8 },
  bootSub: { color: Colors.inkFaint, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 14, paddingHorizontal: 6 },

  micArea: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: Colors.brand },
  mic: { width: 116, height: 116, borderRadius: 58, alignItems: 'center', justifyContent: 'center' },

  wave: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 50, marginTop: 22 },
  bar: { width: 5, borderRadius: 3 },

  live: { color: Colors.ink, fontSize: 18, lineHeight: 25, textAlign: 'center', marginTop: 26, paddingHorizontal: 8 },
  hint: { color: Colors.inkFaint, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 26, paddingHorizontal: 16 },
  error: { color: Colors.accentRed, fontSize: 14, textAlign: 'center', marginTop: 26, paddingHorizontal: 16 },

  draftCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outline,
    padding: 16,
    marginBottom: 16,
  },
  draftLabel: { color: Colors.inkFaint, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  draftText: { color: Colors.ink, fontSize: 16, lineHeight: 23, marginTop: 8 },
  draftActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  flexBtn: { flex: 1 },
  saveBtn: { marginTop: 10 },
  saveGrad: {
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  steps: { marginBottom: 18 },
  step: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 12 },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(124,92,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: Colors.brand, fontSize: 13, fontWeight: '800' },
  stepText: { color: Colors.inkSoft, fontSize: 14, flex: 1 },

  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: Colors.surfaceVariant,
    borderColor: Colors.outline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toastText: { color: Colors.ink, fontSize: 14, flex: 1 },
});
