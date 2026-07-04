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
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import { VoiceCommand } from '@/core';
import { useDictation } from '@/hooks/useDictation';
import { useNav } from '@/navigation/nav';
import { buildPipelineConfig, runDictation, useStore } from '@/store';
import { getItem, setItem } from '@/store/appGroup';
import { hostAppFor } from '@/store/hostApps';
import { polish, PolishStyle } from '@/services/polish';
import { useAuth } from '@/hooks/useAuth';
import { Colors, Radius, micGradient, heroMicGradient } from '@/theme/colors';
import { Badge, GhostButton, haptic } from '@/ui/kit';
import {
  addFlowStatusListener,
  addUtteranceFinalListener,
  flowSessionModuleAvailable,
  notifyFlowStatus,
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
  const { settings, snippets, vocabulary, corrections, history, addDictation } = useStore();
  // Lifetime words dictated — a small, proud stat under the header.
  const totalWords = useMemo(
    () => history.reduce((n, d) => n + d.text.split(/\s+/).filter(Boolean).length, 0),
    [history],
  );
  const { recordNonce, recordHost } = useNav();
  const { signedIn } = useAuth();
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  const smartRef = useRef(settings.smartFormat);
  smartRef.current = settings.smartFormat;

  // Tell the native engine whether flow utterances should wait for an AI polish
  // (engine v2+ defers the keyboard hand-off to JS when this flag is on).
  useEffect(() => {
    setItem('flow_polish', settings.smartFormat && signedIn ? 'true' : 'false');
  }, [settings.smartFormat, signedIn]);
  const hostApp = hostAppFor(recordHost);

  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [burstNonce, setBurstNonce] = useState(0);
  // Last flow status from the App Group — shown in the debug stamp so a failed
  // background utterance is visible the moment the app is reopened.
  const [lastFlowStatus, setLastFlowStatus] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setLastFlowStatus(getItem('kbd_flow_status'));
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => sub.remove();
  }, []);
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
  const configRef = useRef(config);
  configRef.current = config;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
      setBurstNonce((n) => n + 1);
      if (settings.haptics) haptic.success();
      // Flow-session utterance (keyboard mic, app in background): hand ONLY this
      // utterance to the keyboard and ping it to insert immediately.
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
      if (settings.smartFormat && signedInRef.current) {
        flashToast('✨ Polishing…');
        polish(next.trim(), 'auto').then((r) => {
          if (r.ok && r.text) {
            setDraft(r.text);
            flashToast(r.isPro ? '✨ Polished' : `✨ Polished — ${r.remaining ?? '?'} free left this week`);
            if (settings.autoCopy) Clipboard.setStringAsync(r.text).catch(() => {});
          } else if (r.error === 'limit_reached') {
            flashToast('Free polishes used up this week — Pro is unlimited');
          }
        });
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

  // Flow utterances are recorded/recognized NATIVELY in the flowsession module
  // (the always-on input stream — reconfiguring audio from the background threw
  // OSStatus '!int'). JS just mirrors status into the Live Activity and books the
  // finished text into history (the keyboard has already inserted it).
  const addDictationRef = useRef(addDictation);
  addDictationRef.current = addDictation;
  useEffect(() => {
    const finalSub = addUtteranceFinalListener(({ text }) => {
      (async () => {
        // Engine v2 defers delivery to us — older engines already inserted raw
        // text themselves, so we must not re-ping on them.
        const engineDefers = getItem('flow_engine_v') === '2';

        // 1. LOCAL pipeline, always (the Android TextCuration port): spoken
        //    punctuation, fillers, repeats, caps, corrections, vocabulary —
        //    deterministic, instant, free. Voice commands don't apply here.
        const outcome = runDictation(
          text,
          { ...settingsRef.current, voiceCommands: false },
          configRef.current,
        );
        let finalText = outcome.kind === 'text' && outcome.text ? outcome.text : text;

        // 2. Optional AI pass — for STRUCTURE (server 'auto' style shapes the text
        //    to its destination), not for commas.
        if (engineDefers && smartRef.current && signedInRef.current) {
          updateLiveActivity('Structuring…', '');
          const r = await polish(finalText, 'auto');
          if (r.ok && r.text) {
            finalText = r.text;
            updateLiveActivity(
              r.isPro ? 'Inserted ✓' : `Inserted ✓ · ${r.remaining ?? '?'} polishes left`,
              finalText,
            );
          } else {
            updateLiveActivity('Inserted (local formatting)', finalText);
          }
        } else {
          updateLiveActivity('Inserted ✓', finalText);
        }

        // 3. Deliver to the keyboard (engine v2 only; guard against the native
        //    8s raw fallback having already delivered).
        if (engineDefers) {
          if (getItem('kbd_flow_status') === 'processing') {
            setItem('latest_dictation', finalText);
            setItem('latest_dictation_ts', String(Date.now()));
            setItem('kbd_flow_status', 'inserted');
            notifyResultReady();
            notifyFlowStatus();
          }
        }
        addDictationRef.current(finalText);
      })();
    });
    const statusSub = addFlowStatusListener(({ status }) => {
      if (status === 'listening') updateLiveActivity('Listening…', '');
      else if (status === 'processing') updateLiveActivity('Working on your words…', '');
      else if (status.startsWith('error')) updateLiveActivity('Mic error — tap the keyboard mic to retry', status);
    });
    return () => {
      finalSub?.remove();
      statusSub?.remove();
    };
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

  // Reformat: reshape the current draft into a different tone/format on demand —
  // the Wispr/Aqua-style "make it an email / notes / casual" power move, reusing the
  // server polish styles. Requires a session (managed AI); costs one polish credit.
  const [reformatting, setReformatting] = useState<PolishStyle | null>(null);
  const REFORMATS: { style: PolishStyle; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { style: 'cleanup', label: 'Clean', icon: 'sparkles-outline' },
    { style: 'email', label: 'Email', icon: 'mail-outline' },
    { style: 'message', label: 'Casual', icon: 'chatbubble-ellipses-outline' },
    { style: 'notes', label: 'Notes', icon: 'list-outline' },
  ];
  const reformat = async (style: PolishStyle) => {
    const text = draftRef.current.trim();
    if (!text || reformatting) return;
    if (!signedInRef.current) {
      flashToast('Sign in (Settings) to reformat with AI');
      return;
    }
    setReformatting(style);
    if (settings.haptics) haptic.tap();
    const r = await polish(text, style);
    setReformatting(null);
    if (r.ok && r.text) {
      setDraft(r.text);
      if (settings.autoCopy) Clipboard.setStringAsync(r.text).catch(() => {});
      flashToast(r.isPro ? '✨ Reformatted' : `✨ Reformatted — ${r.remaining ?? '?'} free left`);
    } else if (r.error === 'limit_reached') {
      flashToast('Free polishes used up this week — Pro is unlimited');
    } else {
      flashToast('Could not reformat — try again');
    }
  };

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
      <AuroraBackdrop />
      <View style={styles.headerRow}>
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>Vibe</Text>
          <Text style={[styles.wordmark, { color: Colors.brand }]}>Flow</Text>
        </View>
        <Badge label={settings.onDeviceOnly ? 'ON-DEVICE' : 'CLOUD'} tone={settings.onDeviceOnly ? 'brand' : 'amber'} />
      </View>

      {totalWords > 0 ? (
        <Text style={styles.wordStat}>
          🎙 {totalWords.toLocaleString()} words spoken with VibeFlow
        </Text>
      ) : null}

      {sessionActive ? (
        <View style={styles.sessionBar}>
          <PulsingDot />
          <Text style={styles.sessionText}>
            {liveActivityAvailable()
              ? 'Flow Session live — dictate from the keyboard mic, no switching'
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
              {hostApp ? (
                <Pressable
                  onPress={() => Linking.openURL(hostApp.scheme).catch(() => {})}
                  style={({ pressed }) => [styles.saveBtn, { alignSelf: 'stretch', marginTop: 18 }, pressed && { opacity: 0.9 }]}
                >
                  <LinearGradient colors={[...micGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.saveGrad}>
                    <Ionicons name="arrow-undo" size={20} color="#fff" />
                    <Text style={styles.saveText}>Return to {hostApp.name}</Text>
                  </LinearGradient>
                </Pressable>
              ) : (
                <>
                  {/* Host app unknown → deterministic quick-return buttons (center
                      screen; the top-left breadcrumb is unusable on a cracked
                      corner). Tapping opens the app via its URL scheme. */}
                  <Pressable
                    onPress={() => Linking.openURL('whatsapp://').catch(() => {})}
                    style={({ pressed }) => [styles.saveBtn, { alignSelf: 'stretch', marginTop: 18 }, pressed && { opacity: 0.9 }]}
                  >
                    <LinearGradient colors={[...micGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.saveGrad}>
                      <Ionicons name="logo-whatsapp" size={20} color="#fff" />
                      <Text style={styles.saveText}>Return to WhatsApp</Text>
                    </LinearGradient>
                  </Pressable>
                  <View style={styles.quickReturnRow}>
                    <GhostButton label="Telegram" onPress={() => Linking.openURL('tg://').catch(() => {})} style={styles.flexBtn} />
                    <GhostButton label="Messages" onPress={() => Linking.openURL('messages://').catch(() => {})} style={styles.flexBtn} />
                    <GhostButton label="Slack" onPress={() => Linking.openURL('slack://').catch(() => {})} style={styles.flexBtn} />
                  </View>
                  <Text style={[styles.bootSub, { marginTop: 10 }]}>
                    …or a different app: tap ‹ back in the top-left corner
                  </Text>
                </>
              )}
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
          <KaraokeTranscript text={live} />
        ) : (
          <Text style={styles.hint}>
            Speak naturally. Say “new line”, “comma”, or “question mark”. Say
            “scratch that” to undo.
          </Text>
        )}

        <SavedBurst nonce={burstNonce} />
      </View>
      )}

      {showDraft ? (
        <View style={styles.draftCard}>
          <Text style={styles.draftLabel}>DRAFT</Text>
          <Text style={styles.draftText}>{draft.trim()}</Text>
          {signedIn ? (
            <>
              <Text style={styles.reformatLabel}>REFORMAT AS</Text>
              <View style={styles.reformatRow}>
                {REFORMATS.map((rf) => (
                  <Pressable
                    key={rf.style}
                    onPress={() => reformat(rf.style)}
                    disabled={!!reformatting}
                    style={({ pressed }) => [styles.reformatChip, pressed && { opacity: 0.7 }]}
                  >
                    {reformatting === rf.style ? (
                      <ActivityIndicator size="small" color={Colors.brand} />
                    ) : (
                      <Ionicons name={rf.icon} size={14} color={Colors.inkSoft} />
                    )}
                    <Text style={styles.reformatChipText}>{rf.label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
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

      {/* Code-version stamp: which OTA bundle is actually running (debug lifeline). */}
      <Text style={styles.buildStamp}>
        code {Updates.updateId ? Updates.updateId.slice(-8) : 'embedded'}
        {lastFlowStatus ? ` · flow: ${lastFlowStatus}` : ''}
        {recordHost ? ` · from: ${recordHost}` : ''}
      </Text>
    </View>
  );
}

// --- karaoke transcript (words fade in as you speak) ---------------------------

function KaraokeTranscript({ text }: { text: string }) {
  const all = text.split(/\s+/).filter(Boolean);
  const window = all.slice(-20);
  const start = all.length - window.length;
  return (
    <View style={styles.karaokeWrap}>
      {window.map((w, i) => (
        <FadeInWord
          key={`${start + i}`}
          word={w}
          hot={i >= window.length - 3}
        />
      ))}
    </View>
  );
}

function FadeInWord({ word, hot }: { word: string; hot: boolean }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [a]);
  return (
    <Animated.Text
      style={[
        styles.kWord,
        hot && styles.kWordHot,
        { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
      ]}
    >
      {word}{' '}
    </Animated.Text>
  );
}

// --- saved-moment burst (ring + check pop when a dictation lands) --------------

function SavedBurst({ nonce }: { nonce: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (nonce === 0) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 850, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [nonce, anim]);
  if (nonce === 0) return null;

  const ringScale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.4] });
  const ringOpacity = anim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] });
  const checkScale = anim.interpolate({ inputRange: [0, 0.25, 0.45, 1], outputRange: [0.3, 1.15, 1, 1] });
  const checkOpacity = anim.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] });

  return (
    <View pointerEvents="none" style={styles.burstWrap}>
      <Animated.View style={[styles.burstRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
      <Animated.View style={{ transform: [{ scale: checkScale }], opacity: checkOpacity }}>
        <Ionicons name="checkmark-circle" size={54} color={Colors.success} />
      </Animated.View>
    </View>
  );
}

// --- live session dot (breathes while the engine is alive) --------------------

function PulsingDot() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] });
  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[styles.sessionDot, { transform: [{ scale }], opacity }]} />
    </View>
  );
}

// --- aurora backdrop (slow-drifting brand gradients; pure ambience) -----------

function AuroraBackdrop() {
  const drift1 = useRef(new Animated.Value(0)).current;
  const drift2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = (v: Animated.Value, duration: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
    const l1 = loop(drift1, 14000);
    const l2 = loop(drift2, 19000);
    l1.start();
    l2.start();
    return () => {
      l1.stop();
      l2.stop();
    };
  }, [drift1, drift2]);

  const t1 = drift1.interpolate({ inputRange: [0, 1], outputRange: [-40, 30] });
  const t2 = drift2.interpolate({ inputRange: [0, 1], outputRange: [30, -40] });
  const r1 = drift1.interpolate({ inputRange: [0, 1], outputRange: ['-12deg', '8deg'] });
  const r2 = drift2.interpolate({ inputRange: [0, 1], outputRange: ['10deg', '-10deg'] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.auroraBlob, { top: -120, left: -80, transform: [{ translateY: t1 }, { rotate: r1 }] }]}>
        <LinearGradient
          colors={['rgba(124,92,255,0.32)', 'rgba(124,92,255,0)']}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.auroraFill}
        />
      </Animated.View>
      <Animated.View style={[styles.auroraBlob, { bottom: -140, right: -100, transform: [{ translateY: t2 }, { rotate: r2 }] }]}>
        <LinearGradient
          colors={['rgba(84,160,255,0.22)', 'rgba(190,92,255,0.10)', 'rgba(84,160,255,0)']}
          start={{ x: 0.8, y: 1 }}
          end={{ x: 0.1, y: 0 }}
          style={styles.auroraFill}
        />
      </Animated.View>
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
  const breath = useRef(new Animated.Value(0)).current;

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

  // Idle "breathing" glow — the mic feels alive before you ever touch it.
  useEffect(() => {
    if (!listening) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breath, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breath, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    breath.setValue(0);
  }, [listening, breath]);

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
  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1.22] });
  const breathOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.3] });

  return (
    <View style={styles.micArea}>
      {listening ? (
        <Animated.View
          style={[styles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
        />
      ) : (
        <Animated.View
          style={[styles.ring, { transform: [{ scale: breathScale }], opacity: breathOpacity }]}
        />
      )}
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={listening ? 'Stop' : 'Start dictation'}>
          <LinearGradient
            colors={listening ? ['#E54749', '#FF7A6B'] : [...heroMicGradient]}
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
    if (!listening) return;
    const target = Math.max(0.15, level);
    const animations = bars.map((bar, i) => {
      // give each bar a slightly different response so it looks alive
      const variance = 0.6 + 0.5 * Math.abs(Math.sin((i + 1) * 1.7));
      return Animated.timing(bar, {
        toValue: Math.min(1, target * variance + 0.1),
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      });
    });
    Animated.parallel(animations).start();
  }, [level, listening, bars]);

  // Idle: a slow wave travels through the bars — the brand's waveform, alive.
  useEffect(() => {
    if (listening) return;
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 130),
          Animated.timing(bar, { toValue: 0.42, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          Animated.timing(bar, { toValue: 0.12, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          Animated.delay((BAR_COUNT - i) * 130),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [listening, bars]);

  return (
    <View style={styles.wave}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              height: bar.interpolate({ inputRange: [0, 1], outputRange: [6, 46] }),
              backgroundColor: listening ? Colors.brand : 'rgba(124,92,255,0.45)',
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
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(124,92,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(160,130,255,0.45)',
    shadowColor: Colors.brand,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  sessionDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#39D98A' },
  wordStat: { color: Colors.inkFaint, fontSize: 12.5, marginTop: 10 },
  sessionText: { flex: 1, color: Colors.ink, fontSize: 12.5, lineHeight: 17 },

  bootTitle: { color: Colors.ink, fontSize: 24, fontWeight: '800', marginTop: 18, textAlign: 'center' },
  bootBig: { color: Colors.ink, fontSize: 20, lineHeight: 28, textAlign: 'center', marginTop: 14, paddingHorizontal: 8 },
  bootSub: { color: Colors.inkFaint, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 14, paddingHorizontal: 6 },

  micArea: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: '#7C5CFF' },
  mic: { width: 116, height: 116, borderRadius: 58, alignItems: 'center', justifyContent: 'center' },

  wave: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 50, marginTop: 22 },
  bar: { width: 5, borderRadius: 3 },

  buildStamp: { position: 'absolute', bottom: 2, alignSelf: 'center', color: Colors.inkFaint, fontSize: 10, opacity: 0.6 },

  auroraBlob: { position: 'absolute', width: 420, height: 420 },
  auroraFill: { flex: 1, borderRadius: 210 },
  quickReturnRow: { flexDirection: 'row', gap: 10, marginTop: 12, alignSelf: 'stretch' },

  karaokeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 24,
    paddingHorizontal: 10,
    maxHeight: 130,
    overflow: 'hidden',
  },
  kWord: { color: Colors.karaokeDim, fontSize: 22, lineHeight: 32, fontWeight: '600' },
  kWordHot: { color: Colors.ink, textShadowColor: 'rgba(124,92,255,0.8)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } },

  burstWrap: { position: 'absolute', alignSelf: 'center', top: '38%', alignItems: 'center', justifyContent: 'center' },
  burstRing: { position: 'absolute', width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: Colors.success },
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
  reformatLabel: { color: Colors.inkFaint, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginTop: 16 },
  reformatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  reformatChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 34,
    borderRadius: 10, backgroundColor: Colors.chipBg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.outline,
  },
  reformatChipText: { color: Colors.inkSoft, fontSize: 13, fontWeight: '600' },
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
