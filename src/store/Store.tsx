/**
 * The single source of truth for app state. A `useReducer` store wrapped in
 * context, with three side effects:
 *   1. hydrate once from the SQLite KV store on launch,
 *   2. persist the whole blob back on every change,
 *   3. mirror history + snippets into the App Group so the keyboard stays in sync.
 *
 * Components read state and call actions via `useStore()`.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';

import { defaultCurationOptions } from '@/core';
import { setItem } from './appGroup';
import { syncToAppGroup } from './appGroupSync';
import { TENGLISH_STARTER } from './tenglish';
import { kvGet, kvSet } from './kv';
import {
  AppSettings,
  Correction,
  Dictation,
  PersistedState,
  Snippet,
  Term,
  UserProfile,
  defaultPersistedState,
  defaultSettings,
} from './types';

const STORAGE_KEY = 'vibeflow_state_v1';
const HISTORY_CAP = 200;

let _seq = 0;
/** Monotonic unique id (newer = larger), collision-safe within a session. */
function uid(): number {
  _seq = (_seq + 1) % 1000;
  return Date.now() * 1000 + _seq;
}

type Action =
  | { type: 'HYDRATE'; payload: PersistedState }
  | { type: 'ADD_DICTATION'; text: string; raw?: string }
  | { type: 'EDIT_DICTATION'; id: number; text: string }
  | { type: 'TOGGLE_PIN'; id: number }
  | { type: 'DELETE_DICTATION'; id: number }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'ADD_SNIPPET'; trigger: string; expansion: string }
  | { type: 'UPDATE_SNIPPET'; id: number; trigger: string; expansion: string }
  | { type: 'DELETE_SNIPPET'; id: number }
  | { type: 'ADD_TERM'; term: string }
  | { type: 'DELETE_TERM'; id: number }
  | { type: 'ADD_CORRECTION'; from: string; to: string }
  | { type: 'UPDATE_CORRECTION'; id: number; from: string; to: string }
  | { type: 'DELETE_CORRECTION'; id: number }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<AppSettings> }
  | { type: 'SET_PREMIUM'; premium: boolean }
  | { type: 'SET_PROFILE'; profile: UserProfile }
  | { type: 'COMPLETE_DEMO' }
  | { type: 'RESET_DEMO' };

interface State extends PersistedState {
  hydrated: boolean;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'HYDRATE':
      return { ...action.payload, hydrated: true };

    case 'ADD_DICTATION': {
      const text = action.text.trim();
      if (!text) return state;
      // Keep the raw transcription only when it actually differs from the saved text,
      // so History can show a meaningful "as heard" comparison (and we don't bloat entries).
      const raw = action.raw?.trim();
      const entry: Dictation = {
        id: uid(),
        text,
        raw: raw && raw !== text ? raw : undefined,
        createdAt: Date.now(),
        pinned: false,
      };
      return { ...state, history: [entry, ...state.history].slice(0, HISTORY_CAP) };
    }

    case 'EDIT_DICTATION':
      return {
        ...state,
        history: state.history.map((d) =>
          d.id === action.id ? { ...d, text: action.text } : d,
        ),
      };
    case 'TOGGLE_PIN':
      return {
        ...state,
        history: state.history.map((d) =>
          d.id === action.id ? { ...d, pinned: !d.pinned } : d,
        ),
      };

    case 'DELETE_DICTATION':
      return { ...state, history: state.history.filter((d) => d.id !== action.id) };

    case 'CLEAR_HISTORY':
      return { ...state, history: state.history.filter((d) => d.pinned) };

    case 'ADD_SNIPPET': {
      const trigger = action.trigger.trim();
      if (!trigger) return state;
      const snippet: Snippet = { id: uid(), trigger, expansion: action.expansion };
      return { ...state, snippets: [...state.snippets, snippet] };
    }

    case 'UPDATE_SNIPPET':
      return {
        ...state,
        snippets: state.snippets.map((s) =>
          s.id === action.id
            ? { ...s, trigger: action.trigger.trim(), expansion: action.expansion }
            : s,
        ),
      };

    case 'DELETE_SNIPPET':
      return { ...state, snippets: state.snippets.filter((s) => s.id !== action.id) };

    case 'ADD_TERM': {
      const term = action.term.trim();
      if (!term || state.vocabulary.some((t) => t.term.toLowerCase() === term.toLowerCase())) {
        return state;
      }
      return { ...state, vocabulary: [...state.vocabulary, { id: uid(), term }] };
    }

    case 'DELETE_TERM':
      return { ...state, vocabulary: state.vocabulary.filter((t) => t.id !== action.id) };

    case 'ADD_CORRECTION': {
      const from = action.from.trim();
      if (!from) return state;
      const correction: Correction = { id: uid(), from, to: action.to };
      return { ...state, corrections: [...state.corrections, correction] };
    }

    case 'UPDATE_CORRECTION':
      return {
        ...state,
        corrections: state.corrections.map((c) =>
          c.id === action.id ? { ...c, from: action.from.trim(), to: action.to } : c,
        ),
      };

    case 'DELETE_CORRECTION':
      return { ...state, corrections: state.corrections.filter((c) => c.id !== action.id) };

    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case 'SET_PREMIUM':
      return { ...state, premium: action.premium };

    case 'SET_PROFILE':
      return {
        ...state,
        profile: { name: action.profile.name.trim(), jobTitle: action.profile.jobTitle.trim() },
      };

    case 'COMPLETE_DEMO':
      return { ...state, demoCompleted: true };

    case 'RESET_DEMO':
      return { ...state, demoCompleted: false };

    default:
      return state;
  }
}

export interface StoreActions {
  addDictation(text: string, raw?: string): void;
  editDictation(id: number, text: string): void;
  togglePin(id: number): void;
  deleteDictation(id: number): void;
  clearHistory(): void;
  addSnippet(trigger: string, expansion: string): void;
  updateSnippet(id: number, trigger: string, expansion: string): void;
  deleteSnippet(id: number): void;
  addTerm(term: string): void;
  deleteTerm(id: number): void;
  addCorrection(from: string, to: string): void;
  updateCorrection(id: number, from: string, to: string): void;
  deleteCorrection(id: number): void;
  updateSettings(patch: Partial<AppSettings>): void;
  setPremium(premium: boolean): void;
  setProfile(profile: UserProfile): void;
  completeDemo(): void;
  replayDemo(): void;
}

export type StoreValue = State & StoreActions;

const StoreContext = createContext<StoreValue | null>(null);

/** Merge a persisted blob over fresh defaults so new settings keys always exist. */
function mergePersisted(parsed: Partial<PersistedState>): PersistedState {
  const base = defaultPersistedState();
  return {
    ...base,
    ...parsed,
    settings: {
      ...defaultSettings(),
      ...parsed.settings,
      curation: { ...defaultCurationOptions(), ...parsed.settings?.curation },
    },
    history: parsed.history ?? base.history,
    snippets: parsed.snippets ?? base.snippets,
    vocabulary: parsed.vocabulary ?? base.vocabulary,
    corrections: parsed.corrections ?? base.corrections,
    premium: parsed.premium ?? base.premium,
    profile: { ...base.profile, ...parsed.profile },
    // Existing installs (upgrading) already know the app → skip the first-run demo.
    demoCompleted: parsed.demoCompleted ?? (parsed.settings ? true : base.demoCompleted),
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    ...defaultPersistedState(),
    hydrated: false,
  });

  // 1. Hydrate once.
  useEffect(() => {
    let active = true;
    kvGet(STORAGE_KEY).then((json) => {
      if (!active) return;
      let payload: PersistedState;
      try {
        payload = json ? mergePersisted(JSON.parse(json)) : defaultPersistedState();
      } catch {
        payload = defaultPersistedState();
      }
      dispatch({ type: 'HYDRATE', payload });
    });
    return () => {
      active = false;
    };
  }, []);

  // 2. Persist on change (after hydration so we don't clobber stored data).
  useEffect(() => {
    if (!state.hydrated) return;
    const persisted: PersistedState = {
      settings: state.settings,
      history: state.history,
      snippets: state.snippets,
      vocabulary: state.vocabulary,
      corrections: state.corrections,
      premium: state.premium,
      profile: state.profile,
      demoCompleted: state.demoCompleted,
    };
    kvSet(STORAGE_KEY, JSON.stringify(persisted));
  }, [state]);

  // 3. Mirror to the App Group whenever the keyboard-visible data changes, plus the
  //    selected language so the keyboard can localise autocorrect/suggestions.
  useEffect(() => {
    if (!state.hydrated) return;
    syncToAppGroup(state.history, state.snippets);
    setItem('kbd_language', state.settings.language);
    // Privacy setting for the native Flow-Session recognizer (keyboard dictation):
    // it honors on-device recognition when this is not "false".
    setItem('flow_on_device', String(state.settings.onDeviceOnly));
    // Keyboard dictation length is DERIVED from the mode — no separate toggle:
    //   cloud (on-device OFF) → continuous / unlimited
    //   on-device (ON)        → proven single ~45s path (countdown line + tap to continue)
    // On-device background recording is CPU-capped by iOS, so continuous is unreliable there.
    // Both the flow module and keyboard read this flag.
    setItem('flow_continuous', String(!state.settings.onDeviceOnly));
    // Personal dictionary for the keyboard: starter romanized Telugu/Hindi + the
    // user's Vocabulary terms, so it won't autocorrect them and can suggest them.
    const learned = Array.from(
      new Set([...TENGLISH_STARTER, ...state.vocabulary.map((t) => t.term)]),
    );
    setItem('kbd_learned_words', JSON.stringify(learned));
  }, [
    state.history,
    state.snippets,
    state.settings.language,
    state.settings.onDeviceOnly,
    state.vocabulary,
    state.hydrated,
  ]);

  const actions = useMemo<StoreActions>(
    () => ({
      addDictation: (text, raw) => dispatch({ type: 'ADD_DICTATION', text, raw }),
      editDictation: (id, text) => dispatch({ type: 'EDIT_DICTATION', id, text }),
      togglePin: (id) => dispatch({ type: 'TOGGLE_PIN', id }),
      deleteDictation: (id) => dispatch({ type: 'DELETE_DICTATION', id }),
      clearHistory: () => dispatch({ type: 'CLEAR_HISTORY' }),
      addSnippet: (trigger, expansion) => dispatch({ type: 'ADD_SNIPPET', trigger, expansion }),
      updateSnippet: (id, trigger, expansion) =>
        dispatch({ type: 'UPDATE_SNIPPET', id, trigger, expansion }),
      deleteSnippet: (id) => dispatch({ type: 'DELETE_SNIPPET', id }),
      addTerm: (term) => dispatch({ type: 'ADD_TERM', term }),
      deleteTerm: (id) => dispatch({ type: 'DELETE_TERM', id }),
      addCorrection: (from, to) => dispatch({ type: 'ADD_CORRECTION', from, to }),
      updateCorrection: (id, from, to) => dispatch({ type: 'UPDATE_CORRECTION', id, from, to }),
      deleteCorrection: (id) => dispatch({ type: 'DELETE_CORRECTION', id }),
      updateSettings: (patch) => dispatch({ type: 'UPDATE_SETTINGS', patch }),
      setPremium: (premium) => dispatch({ type: 'SET_PREMIUM', premium }),
      setProfile: (profile) => dispatch({ type: 'SET_PROFILE', profile }),
      completeDemo: () => dispatch({ type: 'COMPLETE_DEMO' }),
      replayDemo: () => dispatch({ type: 'RESET_DEMO' }),
    }),
    [],
  );

  const value = useMemo<StoreValue>(() => ({ ...state, ...actions }), [state, actions]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within a <StoreProvider>');
  return ctx;
}
