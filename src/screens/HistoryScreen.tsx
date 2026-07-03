/**
 * History — every formatted dictation you've saved, newest first (pinned float to
 * the top). Search to find one, copy it to the clipboard, pin the keepers, or
 * delete what you don't need. The most recent saved entry is what the keyboard
 * inserts, so this is also where you curate that shared list.
 */
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { polish } from '@/services/polish';
import { Dictation, useStore } from '@/store';
import { Colors, Radius } from '@/theme/colors';
import {
  Badge,
  Card,
  EmptyState,
  IconButton,
  Screen,
  TextField,
  Type,
  haptic,
} from '@/ui/kit';

/** Human, glanceable relative time: "just now", "5m ago", "3h ago", "2d ago", else a date. */
function relativeTime(createdAt: number): string {
  const diff = Date.now() - createdAt;
  if (diff < 45 * 1000) return 'just now';
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 7) return `${days}d ago`;
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Your voice, quantified — hero lifetime count, streak, week/time-saved chips and
 * a labeled 7-day sparkline. Time saved = speaking ≈150 wpm vs typing ≈40 wpm.
 */
function StatsCard({ history }: { history: Dictation[] }) {
  const stats = useMemo(() => {
    const wordsOf = (t: string) => t.split(/\s+/).filter(Boolean).length;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    let total = 0;
    let week = 0;
    const daily = Array.from({ length: 7 }, () => 0); // index 6 = today
    const activeDays = new Set<number>();
    for (const d of history) {
      const w = wordsOf(d.text);
      total += w;
      const created = d.createdAt ?? Date.now();
      const dayIndexBack = Math.floor((startOfToday + dayMs - 1 - created) / dayMs); // 0 = today
      if (dayIndexBack >= 0) activeDays.add(dayIndexBack);
      if (dayIndexBack >= 0 && dayIndexBack < 7) {
        week += w;
        daily[6 - dayIndexBack] += w;
      }
    }
    let streak = 0;
    while (activeDays.has(streak)) streak += 1;
    const minutesSaved = Math.round(total * (1 / 40 - 1 / 150));
    // Weekday letters for the sparkline, ending today.
    const letters = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfToday - (6 - i) * dayMs);
      return 'SMTWTFS'[d.getDay()];
    });
    return { total, week, minutesSaved, daily, streak, letters };
  }, [history]);

  const max = Math.max(1, ...stats.daily);
  return (
    <LinearGradient
      colors={['rgba(124,92,255,0.55)', 'rgba(84,160,255,0.25)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={statStyles.edge}
    >
      <View style={statStyles.card}>
        <View style={statStyles.topRow}>
          <Text style={statStyles.kicker}>YOUR VOICE</Text>
          {stats.streak > 1 ? (
            <View style={statStyles.streakChip}>
              <Text style={statStyles.streakText}>🔥 {stats.streak}-day streak</Text>
            </View>
          ) : null}
        </View>

        <View style={statStyles.heroRow}>
          <Text style={statStyles.heroValue}>{stats.total.toLocaleString()}</Text>
          <Text style={statStyles.heroUnit}>words{'\n'}spoken</Text>
        </View>

        <View style={statStyles.chipRow}>
          <View style={statStyles.chip}>
            <Ionicons name="calendar-outline" size={13} color={Colors.inkFaint} />
            <Text style={statStyles.chipText}>{stats.week.toLocaleString()} this week</Text>
          </View>
          <View style={statStyles.chip}>
            <Ionicons name="flash-outline" size={13} color={Colors.inkFaint} />
            <Text style={statStyles.chipText}>
              {stats.minutesSaved >= 60
                ? `${Math.floor(stats.minutesSaved / 60)}h ${stats.minutesSaved % 60}m saved`
                : `${stats.minutesSaved}m saved`}
            </Text>
          </View>
        </View>

        <View style={statStyles.spark}>
          {stats.daily.map((v, i) => (
            <View key={i} style={statStyles.sparkSlot}>
              <View
                style={[
                  statStyles.sparkBar,
                  {
                    height: 6 + (v / max) * 30,
                    backgroundColor: i === 6 ? Colors.brand : 'rgba(124,92,255,0.35)',
                    shadowColor: Colors.brand,
                    shadowOpacity: i === 6 ? 0.8 : 0,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 0 },
                  },
                ]}
              />
              <Text style={[statStyles.sparkLabel, i === 6 && { color: Colors.brand, fontWeight: '700' }]}>
                {stats.letters[i]}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </LinearGradient>
  );
}

const statStyles = StyleSheet.create({
  edge: { borderRadius: Radius.card + 1.5, padding: 1.5, marginBottom: 14 },
  card: { backgroundColor: Colors.statInner, borderRadius: Radius.card, padding: 16, gap: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { color: Colors.inkFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  streakChip: {
    backgroundColor: 'rgba(255,159,10,0.15)',
    borderColor: 'rgba(255,159,10,0.45)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  streakText: { color: '#FFB84D', fontSize: 12, fontWeight: '700' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroValue: { color: Colors.ink, fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  heroUnit: { color: Colors.inkFaint, fontSize: 12.5, lineHeight: 15 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipText: { color: Colors.ink, fontSize: 12.5, fontWeight: '600' },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 2 },
  sparkSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  sparkBar: { width: '68%', borderRadius: 3 },
  sparkLabel: { color: Colors.inkFaint, fontSize: 9.5 },
});

export function HistoryScreen() {
  const { history, togglePin, deleteDictation, clearHistory, editDictation } = useStore();
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [polishingId, setPolishingId] = useState<number | null>(null);

  // Manual ✨ polish for any saved dictation (e.g. ones captured before signing in).
  const onPolish = async (item: Dictation) => {
    if (polishingId) return;
    setPolishingId(item.id);
    haptic.tap();
    const r = await polish(item.text, 'structured');
    setPolishingId(null);
    if (r.ok && r.text) {
      editDictation(item.id, r.text);
      setExpandedId(item.id);
      haptic.success();
      setToast(r.isPro ? '✨ Polished' : `✨ Polished — ${r.remaining ?? '?'} free left this week`);
    } else if (r.error === 'limit_reached') {
      setToast('Free polishes used up this week — Pro is unlimited');
    } else if (r.error === 'signed_out') {
      setToast('Sign in under Settings → Account & AI to polish');
    } else if (r.error === 'maintenance') {
      setToast(r.message || 'AI polish is briefly down for maintenance');
    } else {
      setToast('Couldn\u2019t polish — check your connection and try again');
    }
  };

  // Auto-dismiss the inline toast (mirrors the Talk screen pattern).
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // Pinned first, then newest (by id descending).
  const sorted = useMemo<Dictation[]>(() => {
    return [...history].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.id - a.id;
    });
  }, [history]);

  const filtered = useMemo<Dictation[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((d) => d.text.toLowerCase().includes(q));
  }, [sorted, query]);

  const onCopy = async (text: string) => {
    await Clipboard.setStringAsync(text.trim());
    haptic.success();
    setToast('Copied');
  };

  const onTogglePin = (item: Dictation) => {
    haptic.tap();
    togglePin(item.id);
  };

  const onDelete = (item: Dictation) => {
    Alert.alert('Delete dictation', 'This removes it from history and the keyboard.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          haptic.warning();
          deleteDictation(item.id);
        },
      },
    ]);
  };

  const onClearAll = () => {
    Alert.alert(
      'Clear history',
      'This deletes all unpinned dictations. Pinned items are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            haptic.warning();
            clearHistory();
            setToast('History cleared');
          },
        },
      ],
    );
  };

  const subtitle = `${history.length} saved`;
  const showSearch = history.length > 0;

  return (
    <View style={styles.root}>
      <Screen
        title="History"
        subtitle={subtitle}
        right={
          history.length > 0 ? (
            <IconButton
              icon="trash-outline"
              onPress={onClearAll}
              accessibilityLabel="Clear history"
            />
          ) : undefined
        }
      >
        {history.length > 0 ? <StatsCard history={history} /> : null}

        {showSearch ? (
          <View style={styles.search}>
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder="Search dictations"
            />
          </View>
        ) : null}

        {history.length === 0 ? (
          <EmptyState
            icon="mic-outline"
            title="No dictations yet"
            message="Dictate on the Talk tab — your formatted text is saved here and made available to the keyboard."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title="No matches"
            message={`Nothing in your history matches “${query.trim()}”.`}
          />
        ) : (
          <View style={styles.list}>
            {filtered.map((item) => {
              const words = item.text.split(/\s+/).filter(Boolean).length;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    haptic.tap();
                    setExpandedId(expandedId === item.id ? null : item.id);
                  }}
                  accessibilityHint="Tap to expand"
                  style={({ pressed }) => [
                    styles.entry,
                    item.pinned && styles.entryPinned,
                    pressed && { opacity: 0.88, transform: [{ scale: 0.995 }] },
                  ]}
                >
                  <View style={styles.entryHeader}>
                    <View style={styles.timeChip}>
                      <Ionicons name="mic" size={11} color={Colors.brand} />
                      <Text style={styles.timeChipText}>{relativeTime(item.createdAt)}</Text>
                    </View>
                    <Text style={styles.wordCount}>{words} {words === 1 ? 'word' : 'words'}</Text>
                    <View style={{ flex: 1 }} />
                    {item.pinned ? <Ionicons name="star" size={14} color={Colors.amber} /> : null}
                  </View>

                  <Text
                    style={styles.entryText}
                    numberOfLines={expandedId === item.id ? undefined : 4}
                  >
                    {item.text}
                  </Text>

                  <View style={styles.entryFooter}>
                    <Text style={styles.copyHint}>
                      {expandedId === item.id ? 'tap to collapse' : 'tap to read all'}
                    </Text>
                    <View style={styles.entryActions}>
                      <CircleAction
                        icon={polishingId === item.id ? 'hourglass-outline' : 'sparkles-outline'}
                        color={Colors.brand}
                        label="AI polish"
                        onPress={() => onPolish(item)}
                      />
                      <CircleAction
                        icon="copy-outline"
                        color={Colors.inkSoft}
                        label="Copy"
                        onPress={() => onCopy(item.text)}
                      />
                      <CircleAction
                        icon={item.pinned ? 'star' : 'star-outline'}
                        color={item.pinned ? Colors.amber : Colors.inkSoft}
                        label={item.pinned ? 'Unpin' : 'Pin'}
                        onPress={() => onTogglePin(item)}
                      />
                      <CircleAction
                        icon="trash-outline"
                        color={Colors.accentRed}
                        label="Delete"
                        onPress={() => onDelete(item)}
                      />
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </Screen>

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text style={styles.toastText} numberOfLines={1}>
            {toast}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Small circular icon action on each history card. */
function CircleAction({
  icon,
  color,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.circleBtn, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={16} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  search: { marginBottom: 16 },
  list: { gap: 12 },

  entry: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.hairline,
    padding: 14,
  },
  entryPinned: {
    borderColor: 'rgba(255,184,77,0.45)',
    shadowColor: Colors.amber,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  entryText: { color: Colors.ink, fontSize: 15.5, lineHeight: 22.5 },

  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(124,92,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  timeChipText: { color: Colors.inkSoft, fontSize: 11.5, fontWeight: '600' },
  wordCount: { color: Colors.inkFaint, fontSize: 11.5 },

  entryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.hairline,
  },
  copyHint: { color: Colors.inkFaint, fontSize: 11 },
  entryActions: { flexDirection: 'row', gap: 8 },
  circleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
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
