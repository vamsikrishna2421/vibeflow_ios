/**
 * Vocabulary — the user's custom dictionary. Product names, acronyms, and people
 * whose exact spelling and casing Mynah should always restore when the
 * recogniser mishears them (e.g. "github" → "GitHub").
 *
 * A pushed stack screen: add a term up top, then manage the saved set as a
 * wrapped grid of removable chips. Mirrors TalkScreen's premium, dark-first feel.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useNav } from '@/navigation/nav';
import { getItem, setItem } from '@/store/appGroup';
import { useStore } from '@/store';
import { Colors, Spacing } from '@/theme/colors';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  Screen,
  SectionTitle,
  TextField,
  Type,
  haptic,
} from '@/ui/kit';

export function VocabularyScreen() {
  const { vocabulary, addTerm, deleteTerm } = useStore();
  const { pop } = useNav();

  const [value, setValue] = useState('');
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  // Transient inline feedback under the add row (no toast — stays in flow so it
  // never fights the scroll view).
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 1900);
    return () => clearTimeout(t);
  }, [note]);

  const canAdd = value.trim().length > 0;

  const onAdd = () => {
    const term = value.trim();
    if (!term) {
      haptic.warning();
      return;
    }
    const exists = vocabulary.some((t) => t.term.toLowerCase() === term.toLowerCase());
    if (exists) {
      setNote({ text: `“${term}” is already saved`, tone: 'warn' });
      haptic.warning();
      return;
    }
    addTerm(term); // ignores blanks/dupes defensively
    setValue('');
    setNote({ text: `Added “${term}”`, tone: 'ok' });
    haptic.success();
  };

  const confirmDelete = (id: number, term: string) => {
    Alert.alert(
      'Remove word',
      `“${term}” will no longer be auto-corrected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            deleteTerm(id);
            haptic.medium();
          },
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <Screen
      title="Vocabulary"
      subtitle="Keep the right spelling & casing"
      onBack={pop}
      right={vocabulary.length ? <Badge label={String(vocabulary.length)} tone="brand" /> : undefined}
    >
      {/* What this does */}
      <Card>
        <View style={styles.hintRow}>
          <View style={styles.hintIcon}>
            <Ionicons name="sparkles" size={18} color={Colors.brand} />
          </View>
          <Text style={[Type.bodySoft, styles.hintText]}>
            When the recogniser hears one of these words, Mynah restores its exact spelling and
            capitalisation. Longer terms win.
          </Text>
        </View>
      </Card>

      {/* Add a term */}
      <View style={styles.addRow}>
        <View style={styles.addField}>
          <TextField
            value={value}
            onChangeText={setValue}
            placeholder="Add a term, e.g. GitHub"
            autoCapitalize="none"
          />
        </View>
        <Pressable
          onPress={onAdd}
          disabled={!canAdd}
          accessibilityRole="button"
          accessibilityLabel="Add term"
          style={({ pressed }) => [
            styles.addBtn,
            { opacity: !canAdd ? 0.45 : pressed ? 0.85 : 1 },
          ]}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      </View>

      {note ? (
        <Text
          style={[
            styles.note,
            { color: note.tone === 'ok' ? Colors.success : Colors.amber },
          ]}
        >
          {note.text}
        </Text>
      ) : null}

      {/* The saved set */}
      {vocabulary.length === 0 ? (
        <EmptyState
          icon="book-outline"
          title="No custom words"
          message="Add product names, acronyms, or names so they’re always spelled right."
        />
      ) : (
        <>
          <SectionTitle>Your words</SectionTitle>
          <View style={styles.chips}>
            {vocabulary.map((t) => (
              <Chip
                key={t.id}
                label={t.term}
                icon="close"
                tone="brand"
                onPress={() => confirmDelete(t.id, t.term)}
              />
            ))}
          </View>
          <Text style={styles.tip}>Tap a word to remove it.</Text>
        </>
      )}

      {/* Words the keyboard picked up from your typing (on-device learning). */}
      <LearnedWords />
    </Screen>
  );
}

/**
 * The keyboard's self-learned lexicon (words typed 2+ times — protected from
 * autocorrect, offered as completions). Read from the App Group; tapping a word
 * un-learns it.
 */
function LearnedWords() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const json = getItem('kbd_learned_counts');
      if (json) setCounts(JSON.parse(json));
    } catch {}
  }, []);

  const words = Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  if (words.length === 0) return null;

  const unlearn = (word: string) => {
    const next = { ...counts };
    delete next[word];
    setCounts(next);
    try {
      setItem('kbd_learned_counts', JSON.stringify(next));
    } catch {}
    haptic.tap();
  };

  return (
    <>
      <SectionTitle>Learned from your typing</SectionTitle>
      <Text style={[Type.bodySoft, { marginBottom: 10 }]}>
        Your keyboard picked these up on-device — it won't autocorrect them and will
        suggest them as you type. Tap to un-learn.
      </Text>
      <View style={styles.chips}>
        {words.map(([w, c]) => (
          <Chip key={w} label={`${w} · ${c}`} icon="close" tone="default" onPress={() => unlearn(w)} />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  hintIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: { flex: 1 },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
  addField: { flex: 1 },
  addBtn: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },

  note: { marginTop: 10, fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.gap,
  },
  tip: {
    color: Colors.inkFaint,
    fontSize: 13,
    marginTop: 16,
  },
});
