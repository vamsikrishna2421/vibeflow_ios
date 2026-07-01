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
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export type DictationState = 'idle' | 'listening' | 'error';

export interface UseDictationOptions {
  lang: string;
  onDeviceOnly: boolean;
  onFinal: (transcript: string) => void;
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

export function useDictation({ lang, onDeviceOnly, onFinal }: UseDictationOptions): UseDictation {
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

  // Cold-start guard: SFSpeechRecognizer frequently fires "no speech" on the very
  // first start after launch (audio engine not warmed yet). We retry once before
  // surfacing it — that's the "worked on the second tap" behaviour, automated.
  const retriedRef = useRef(false);
  const startRef = useRef<((isRetry: boolean) => Promise<void>) | null>(null);

  useSpeechRecognitionEvent('start', () => setState('listening'));

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
    // Library reports roughly -2 (silence) .. 10 (loud) dB; map to 0..1.
    const value: number = typeof event?.value === 'number' ? event.value : 0;
    setLevel(Math.max(0, Math.min(1, (value + 2) / 12)));
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    const msg = event?.message ?? event?.error ?? 'Speech recognition error';
    const isNoSpeech =
      /no.?speech/i.test(String(msg)) || event?.error === 'no-speech';
    if (isNoSpeech && !retriedRef.current && !finalRef.current && !partialRef.current) {
      retriedRef.current = true;
      setTimeout(() => {
        startRef.current?.(true);
      }, 300);
      return;
    }
    setError(msg);
    setState('error');
  });

  useSpeechRecognitionEvent('end', () => {
    const full = `${finalRef.current} ${partialRef.current}`.trim();
    finalRef.current = '';
    partialRef.current = '';
    setPartial('');
    setLevel(0);
    setState((s) => (s === 'error' ? 'error' : 'idle'));
    if (full) onFinalRef.current(full);
  });

  const start = useCallback(
    async (isRetry = false) => {
      setError(null);
      if (!isRetry) retriedRef.current = false;
      finalRef.current = '';
      partialRef.current = '';
      setPartial('');
      try {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!perm.granted) {
          setError('Microphone and speech-recognition permission are required.');
          setState('error');
          return;
        }
        ExpoSpeechRecognitionModule.start({
          lang,
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: onDeviceOnly,
          addsPunctuation: true,
          volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
        });
      } catch (e: any) {
        setError(e?.message ?? 'Could not start dictation.');
        setState('error');
      }
    },
    [lang, onDeviceOnly],
  );

  // Let the error handler trigger the one-shot cold-start retry.
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore
    }
  }, []);

  const transcript = `${finalRef.current} ${partial}`.trim();

  return { state, partial, transcript, level, error, start, stop };
}
