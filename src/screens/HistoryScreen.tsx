/**
 * History — every formatted dictation you've saved, newest first (pinned float to
 * the top). Search to find one, copy it to the clipboard, pin the keepers, or
 * delete what you don't need. The most recent saved entry is what the keyboard
 * inserts, so this is also where you curate that shared list.
 */
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

export function HistoryScreen() {
  const { history, togglePin, deleteDictation, clearHistory } = useStore();
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);

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
            {filtered.map((item) => (
              <Card key={item.id} style={styles.entry}>
                <Text style={styles.entryText} numberOfLines={5}>
                  {item.text}
                </Text>

                <View style={styles.metaRow}>
                  <Text style={Type.caption}>{relativeTime(item.createdAt).toUpperCase()}</Text>
                  {item.pinned ? <Badge label="PINNED" tone="amber" /> : null}
                </View>

                <View style={styles.actions}>
                  <ActionButton
                    icon="copy-outline"
                    label="Copy"
                    onPress={() => onCopy(item.text)}
                  />
                  <ActionButton
                    icon={item.pinned ? 'star' : 'star-outline'}
                    label={item.pinned ? 'Unpin' : 'Pin'}
                    active={item.pinned}
                    onPress={() => onTogglePin(item)}
                  />
                  <ActionButton
                    icon="trash-outline"
                    label="Delete"
                    tone="danger"
                    onPress={() => onDelete(item)}
                  />
                </View>
              </Card>
            ))}
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

/** A compact, premium pill action used inside each history card. */
function ActionButton({
  icon,
  label,
  onPress,
  tone = 'default',
  active = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  active?: boolean;
}) {
  const color =
    tone === 'danger' ? Colors.accentRed : active ? Colors.amber : Colors.inkSoft;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  search: { marginBottom: 16 },
  list: { gap: 12 },

  entry: {},
  entryText: { color: Colors.ink, fontSize: 16, lineHeight: 23 },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceVariant,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outline,
  },
  actionLabel: { fontSize: 13, fontWeight: '600' },

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
