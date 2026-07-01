/**
 * Snippets — say a short trigger, insert a longer expansion. The keyboard reads
 * these from the App Group, so a snippet like "my address" can drop your full
 * mailing address at the cursor. This screen lets you create, edit and delete
 * them with a premium, dark-first feel that matches the rest of VibeFlow.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useNav } from '@/navigation/nav';
import { useStore } from '@/store';
import { Colors, Spacing } from '@/theme/colors';
import {
  Card,
  EmptyState,
  GhostButton,
  IconButton,
  PrimaryButton,
  Screen,
  TextField,
  Type,
  haptic,
} from '@/ui/kit';

/** The in-progress add/edit form. `id === null` means we're creating a new one. */
interface Editing {
  id: number | null;
  trigger: string;
  expansion: string;
}

export function SnippetsScreen() {
  const { snippets, addSnippet, updateSnippet, deleteSnippet } = useStore();
  const { pop } = useNav();

  const [editing, setEditing] = useState<Editing | null>(null);

  const openAdd = () => {
    setEditing({ id: null, trigger: '', expansion: '' });
  };

  const openEdit = (id: number, trigger: string, expansion: string) => {
    setEditing({ id, trigger, expansion });
  };

  const closeModal = () => setEditing(null);

  const save = () => {
    if (!editing) return;
    const trigger = editing.trigger.trim();
    if (!trigger) return;
    if (editing.id === null) {
      addSnippet(trigger, editing.expansion);
    } else {
      updateSnippet(editing.id, trigger, editing.expansion);
    }
    haptic.success();
    closeModal();
  };

  const confirmDelete = (id: number, trigger: string) => {
    Alert.alert(
      'Delete snippet?',
      `“${trigger}” will be removed. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            haptic.warning();
            deleteSnippet(id);
          },
        },
      ],
    );
  };

  const canSave = (editing?.trigger.trim().length ?? 0) > 0;

  return (
    <Screen
      title="Snippets"
      subtitle="Say the trigger, insert the expansion"
      onBack={pop}
      right={<IconButton icon="add" onPress={openAdd} accessibilityLabel="Add snippet" />}
    >
      {snippets.length === 0 ? (
        <EmptyState
          icon="flash-outline"
          title="No snippets yet"
          message="Create a trigger phrase that expands to longer text — e.g. say ‘my address’ to insert your full address."
          actionLabel="Add snippet"
          onAction={openAdd}
        />
      ) : (
        <View style={styles.list}>
          {snippets.map((s) => (
            <Card key={s.id} style={styles.snippetCard}>
              <View style={styles.snippetBody}>
                <View style={styles.triggerRow}>
                  <Ionicons name="flash" size={15} color={Colors.brand} />
                  <Text style={[Type.label, styles.triggerText]} numberOfLines={1}>
                    {s.trigger}
                  </Text>
                </View>
                <Text style={[Type.bodySoft, styles.expansionText]} numberOfLines={2}>
                  {s.expansion.trim() ? s.expansion.trim() : 'No expansion text'}
                </Text>
              </View>
              <View style={styles.actions}>
                <IconButton
                  icon="create-outline"
                  size={20}
                  onPress={() => openEdit(s.id, s.trigger, s.expansion)}
                  accessibilityLabel={`Edit ${s.trigger}`}
                />
                <IconButton
                  icon="trash-outline"
                  size={20}
                  color={Colors.accentRed}
                  onPress={() => confirmDelete(s.id, s.trigger)}
                  accessibilityLabel={`Delete ${s.trigger}`}
                />
              </View>
            </Card>
          ))}
        </View>
      )}

      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {editing?.id === null ? 'New snippet' : 'Edit snippet'}
            </Text>
            <Text style={[Type.bodySoft, styles.sheetHint]}>
              The trigger is what you say; the expansion is what gets inserted.
            </Text>

            <View style={styles.fields}>
              <TextField
                label="Trigger"
                value={editing?.trigger ?? ''}
                onChangeText={(trigger) =>
                  setEditing((e) => (e ? { ...e, trigger } : e))
                }
                placeholder="e.g. my address"
                autoCapitalize="none"
                autoFocus
              />
              <TextField
                label="Expansion"
                value={editing?.expansion ?? ''}
                onChangeText={(expansion) =>
                  setEditing((e) => (e ? { ...e, expansion } : e))
                }
                placeholder="The full text to insert…"
                multiline
                autoCapitalize="sentences"
              />
            </View>

            <PrimaryButton
              label="Save"
              icon="checkmark"
              onPress={save}
              disabled={!canSave}
              style={styles.saveBtn}
            />
            <GhostButton label="Cancel" onPress={closeModal} style={styles.cancelBtn} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, marginTop: 4 },

  snippetCard: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  snippetBody: { flex: 1 },
  triggerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  triggerText: { flexShrink: 1 },
  expansionText: { marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  // Add / edit modal — a bottom sheet over a dimmed backdrop.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outline,
    paddingHorizontal: Spacing.gutter,
    paddingTop: 12,
    paddingBottom: 32,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.outline,
    marginBottom: 16,
  },
  sheetTitle: { color: Colors.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  sheetHint: { marginTop: 4 },
  fields: { gap: 16, marginTop: 20 },
  saveBtn: { marginTop: 24 },
  cancelBtn: { marginTop: 10 },
});
