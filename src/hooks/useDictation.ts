/**
 * On-device dictation. Wraps `expo-speech-recognition` (Apple SFSpeechRecognizer
 * under the hood) and exposes a tiny, UI-friendly surface:
 *   • `state`      idle | listening | error
 *   • `transcript` the live best-guess (finalised segments + current partial)
 *   • `level`      mic loudness 0..1 for the waveform
 *   • `start` / `stop`
 *
 * `onFinal` fires once with the full transcript when recognition ends. Recognition
 * runs on-device when `onDeviceOnly` is set, so audio never leaves the phone.
 *
 * Long-recording handling: Apple's ON-DEVICE recognizer has a hard ~1-minute limit
 * per request. Past it the recognizer stalls — `stop()` then waits forever for a
 * final that never comes ("processing forever"), and the stalled task holds the
 * audio session so the next recording is dead until a force-quit. We defeat that
 * with (a) SEGMENT ROTATION — restart the request at a natural pause (and always
 * before the cap), stitching the text together so any length works on-device — and (b) a
 * STOP WATCHDOG — if `end` doesn't arrive shortly after stop(), force-finalise and
 * abort() so it never hangs and the mic is never left stuck.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export type DictationState = 'idle' | 'listening' | 'error';

// Rotation timing. Rather than a hard cut, we look for a NATURAL PAUSE to restart
// the on-device request (so no word is clipped mid-utterance), while never letting a
// segment approach SFSpeechRecognizer's ~60s on-device cap.
const ROTATE_CHECK_MS = 1000; // how often we look for a good moment to rotate
const MIN_SEGMENT_MS = 18000; // don't rotate a segment younger than this
const SILENCE_GAP_MS = 700; // a pause this long is a natural place to rotate
const HARD_CAP_MS = 55000; // …but never let a segment get near the ~60s cap
const SILENCE_LEVEL = 0.06; // normalized mic level below this counts as "silent"
// If the user stops and `end` never arrives (stalled recognizer), force-finalise.
const STOP_WATCHDOG_MS = 3500;

export interface UseDictationOptions {
  lang: string;
  onDeviceOnly: boolean;
  onFinal: (transcript: string) => void;
  /**
   * Terms the recognizer should bias toward — names, job titles, jargon — mapped
   * to SFSpeechRecognitionRequest.contextualStrings. Boosts first-pass accuracy so
   * e.g. the user's name isn't mis-heard. Read live via a ref so `start` stays stable.
   */
  contextualStrings?: string[];
}

export interface UseDictation {
  state: DictationState;
  partial: string;
  transcript: string;
  level: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useDictation({
  lang,
  onDeviceOnly,
  onFinal,
  contextualStrings,
}: UseDictationOptions): UseDictation {
  const [state, setState] = useState<DictationState>('idle');
  const [partial, setPartial] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const finalRef = useRef('');
  const partialRef = useRef('');
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const contextualRef = useRef<string[] | undefined>(contextualStrings);
  useEffect(() => {
    contextualRef.current = contextualStrings;
  }, [contextualStrings]);

  // Session bookkeeping.
  const listeningRef = useRef(false); // a recognizer request is live
  const rotatingRef = useRef(false); // we intentionally stopped to restart (long dictation)
  const stoppingRef = useRef(false); // the USER asked to stop — finalise on end
  const retriedRef = useRef(false); // one-shot cold-start retry used?
  const rotateInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segmentStartRef = useRef(0); // when the current recognizer request began
  const lastVoiceRef = useRef(0); // last time the mic level was above silence
  const startRef = useRef<((isRetry: boolean, isContinuation: boolean) => Promise<void>) | null>(null);

  const clear = (r: { current: ReturnType<typeof setTimeout> | null }) => {
    if (r.current) {
      clearTimeout(r.current);
      r.current = null;
    }
  };

  const stopRotate = () => {
    if (rotateInterval.current) {
      clearInterval(rotateInterval.current);
      rotateInterval.current = null;
    }
  };

  // Emit the full transcript exactly once and reset everything to idle. Idempotent:
  // a second call (e.g. watchdog then a late `end`) finds empty refs and no-ops.
  const finalizeSession = useCallback(() => {
    stopRotate();
    clear(watchdog);
    listeningRef.current = false;
    rotatingRef.current = false;
    stoppingRef.current = false;
    const full = `${finalRef.current} ${partialRef.current}`.trim();
    finalRef.current = '';
    partialRef.current = '';
    setPartial('');
    setLevel(0);
    setState((s) => (s === 'error' ? 'error' : 'idle'));
    if (full) onFinalRef.current(full);
  }, []);

  // Fold the current partial into the accumulated final (used at segment boundaries).
  const commitPartial = () => {
    if (partialRef.current) {
      finalRef.current = `${finalRef.current} ${partialRef.current}`.trim();
      partialRef.current = '';
      setPartial('');
    }
  };

  useSpeechRecognitionEvent('start', () => {
    listeningRef.current = true;
    setState('listening');
  });

  useSpeechRecognitionEvent('result', (event: any) => {
    const transcript: string = event?.results?.[0]?.transcript ?? '';
    if (event?.isFinal) {
      finalRef.current = `${finalRef.current} ${transcript}`.trim();
      partialRef.current = '';
      setPartial('');
    } else {
      partialRef.current = transcript;
      setPartial(transcript);
    }
  });

  useSpeechRecognitionEvent('volumechange', (event: any) => {
    const value: number = typeof event?.value === 'number' ? event.value : 0;
    const lvl = Math.max(0, Math.min(1, (value + 2) / 12));
    setLevel(lvl);
    // Track voice activity so rotation can wait for a natural pause.
    if (lvl > SILENCE_LEVEL) lastVoiceRef.current = Date.now();
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    const msg = event?.message ?? event?.error ?? 'Speech recognition error';
    const isNoSpeech = /no.?speech/i.test(String(msg)) || event?.error === 'no-speech';

    // A rotation stop can surface as an error ("canceled") rather than a clean end —
    // treat it as a segment boundary and continue the long dictation.
    if (rotatingRef.current && !stoppingRef.current) {
      rotatingRef.current = false;
      commitPartial();
      startRef.current?.(true, true);
      return;
    }

    // Cold-start "no speech" on the first tap → retry once silently.
    if (isNoSpeech && !retriedRef.current && !finalRef.current && !partialRef.current) {
      retriedRef.current = true;
      setTimeout(() => startRef.current?.(true, false), 300);
      return;
    }

    // If we already captured something, don't punish the user with an error —
    // just finalise what we have.
    if (finalRef.current || partialRef.current) {
      finalizeSession();
      return;
    }

    stopRotate();
    clear(watchdog);
    listeningRef.current = false;
    setError(msg);
    setState('error');
  });

  useSpeechRecognitionEvent('end', () => {
    listeningRef.current = false;
    // Segment boundary of a long dictation → keep the accumulated text and continue.
    if (rotatingRef.current && !stoppingRef.current) {
      rotatingRef.current = false;
      commitPartial();
      startRef.current?.(true, true);
      return;
    }
    finalizeSession();
  });

  const start = useCallback(
    async (isRetry = false, isContinuation = false) => {
      setError(null);
      if (!isRetry && !isContinuation) {
        retriedRef.current = false;
        stoppingRef.current = false;
        finalRef.current = '';
        partialRef.current = '';
        setPartial('');
      }
      try {
        // Permission is only needed for a user-initiated start, not a continuation.
        if (!isContinuation) {
          const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          if (!perm.granted) {
            setError('Microphone and speech-recognition permission are required.');
            setState('error');
            return;
          }
        }
        const bias = contextualRef.current?.filter((s) => s && s.trim().length > 0);
        ExpoSpeechRecognitionModule.start({
          lang,
          interimResults: true,
          continuous: true,
          // Follows the user's Recognition setting (default: on-device = private).
          requiresOnDeviceRecognition: onDeviceOnly,
          addsPunctuation: true,
          ...(bias && bias.length ? { contextualStrings: bias } : {}),
          volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
          // Join the Flow Session's keep-alive audio session instead of replacing
          // it — reconfiguring the session from the background fails silently.
          iosCategory: {
            category: 'playAndRecord',
            categoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers'],
            mode: 'measurement',
          },
        });
        listeningRef.current = true;
        segmentStartRef.current = Date.now();
        lastVoiceRef.current = Date.now();

        // Rotate before the on-device ~60s cap so long dictation never stalls —
        // preferring a natural silence gap so nothing is clipped mid-word. Cloud
        // recognition has no such cap, so only rotate on-device.
        stopRotate();
        if (onDeviceOnly) {
          // On-device has the ~60s request cap → rotate before it (preferring a natural
          // silence gap). Cloud has no such cap, so only rotate on-device.
          rotateInterval.current = setInterval(() => {
            if (!listeningRef.current || stoppingRef.current || rotatingRef.current) return;
            const now = Date.now();
            const elapsed = now - segmentStartRef.current;
            const sinceVoice = now - lastVoiceRef.current;
            const atNaturalGap = elapsed >= MIN_SEGMENT_MS && sinceVoice >= SILENCE_GAP_MS;
            if (elapsed >= HARD_CAP_MS || atNaturalGap) {
              rotatingRef.current = true;
              stopRotate();
              try {
                ExpoSpeechRecognitionModule.stop(); // finalise this segment → end → continue
              } catch {
                // ignore
              }
            }
          }, ROTATE_CHECK_MS);
        }
      } catch (e: any) {
        setError(e?.message ?? 'Could not start dictation.');
        setState('error');
      }
    },
    [lang, onDeviceOnly],
  );

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    stopRotate();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore
    }
    // Watchdog: the on-device recognizer can stall and never fire `end`. If so,
    // force-finalise with whatever we have and abort() so the session is released
    // and the next recording starts clean (no more "stuck until force-quit").
    clear(watchdog);
    watchdog.current = setTimeout(() => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // ignore
      }
      finalizeSession();
    }, STOP_WATCHDOG_MS);
  }, [finalizeSession]);

  // Tidy timers if the component using dictation unmounts mid-session.
  useEffect(() => {
    return () => {
      stopRotate();
      clear(watchdog);
    };
  }, []);

  const transcript = `${finalRef.current} ${partial}`.trim();

  return { state, partial, transcript, level, error, start, stop };
}
