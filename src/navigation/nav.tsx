/**
 * Lightweight navigation — no react-navigation, mirroring LUCY's lean approach.
 * Three base tabs plus a small "stack" of pushed full-screen routes (snippets,
 * vocabulary, …). Also carries a `recordNonce` the keyboard deep-link bumps to ask
 * the Talk screen to start recording immediately.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';

export type Tab = 'home' | 'history' | 'settings';
export type StackRoute =
  | 'snippets'
  | 'vocabulary'
  | 'corrections'
  | 'keyboardSetup'
  | 'paywall'
  | 'about';

interface NavApi {
  tab: Tab;
  stack: StackRoute[];
  recordNonce: number;
  setTab: (tab: Tab) => void;
  push: (route: StackRoute) => void;
  pop: () => void;
  reset: () => void;
  requestRecord: () => void;
}

const NavContext = createContext<NavApi | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [tab, setTabState] = useState<Tab>('home');
  const [stack, setStack] = useState<StackRoute[]>([]);
  const [recordNonce, setRecordNonce] = useState(0);

  const api = useMemo<NavApi>(
    () => ({
      tab,
      stack,
      recordNonce,
      setTab: (t) => {
        setStack([]);
        setTabState(t);
      },
      push: (r) => setStack((s) => [...s, r]),
      pop: () => setStack((s) => s.slice(0, -1)),
      reset: () => setStack([]),
      requestRecord: () => {
        setStack([]);
        setTabState('home');
        setRecordNonce((n) => n + 1);
      },
    }),
    [tab, stack, recordNonce],
  );

  return <NavContext.Provider value={api}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used within a <NavProvider>');
  return ctx;
}
