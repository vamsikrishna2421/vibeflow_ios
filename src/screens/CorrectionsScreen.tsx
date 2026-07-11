/**
 * Corrections — teach VibeFlow to auto-fix words the recogniser commonly mishears.
 * Each entry is a whole-word, case-insensitive "heard → meant" rewrite that runs
 * inside the text pipeline. Add/edit happens in a modal; deletes confirm first.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useNav } from '@/navigation/nav';
import { useStore } from '@/store';
import { Colors, Radius, Spacing } from '@/theme/colors';
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

export function CorrectionsScreen() {
  const { corrections, addCorrection, updateCorrection, deleteCorrection } = useStore();
  const { pop } = useNav();

  // Modal state: `editingId` null ⇒ adding a new correction.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [heard, setHeard] = useState('');
  const [meant, setMeant] = useState('');

  const openAdd = () => {
    setEditingId(null);
    setHeard('');
    setMeant('');
    setModalOpen(true);
  };

  const openEdit = (id: number, from: string, to: string) => {
    setEditingId(id);
    setHeard(from);
    setMeant(to);
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const canSave = heard.trim().length > 0;

  const onSave = () => {
    if (!canSave) return;
    const from = heard.trim();
    const to = meant.trim();
    if (editingId == null) addCorrection(from, to);
    else updateCorrection(editingId, from, to);
    haptic.success();
    setModalOpen(false);
  };

  const onDelete = (id: number, from: string) => {
    Alert.alert(
      'Delete correction',
      `Remove the rule for “${from}”?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteCorrection(id);
            haptic.warning();
          },
        },
      ],
    );
  };

  return (
    <Screen
      title="Corrections"
      subtitle="Fix what the recogniser mishears"
      onBack={pop}
      right={<IconButton icon="add" onPress={openAdd} accessibilityLabel="Add correction" />}
    >
      {/* Explainer */}
      <Card style={styles.explainCard}>
        <View style={styles.explainRow}>
          <View style={styles.explainIcon}>
            <Ionicons name="bulb-outline" size={18} color={Colors.brand} />
          </View>
          <Text style={[Type.bodySoft, styles.explainText]}>
            Whole-word, case-insensitive. The replacement keeps your casing — e.g.
            “cubanetes” → “Kubernetes”.
          </Text>
        </View>
      </Card>

      {corrections.length === 0 ? (
        <EmptyState
          icon="swap-horizontal-outline"
          title="No corrections"
          message="Teach VibeFlow to auto-fix words it commonly mishears."
          actionLabel="Add correction"
          onAction={openAdd}
        />
      ) : (
        <View style={styles.list}>
          {corrections.map((c) => (
            <Card key={c.id} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <View style={styles.pair}>
                  <View style={[styles.pill, styles.heardPill]}>
                    <Text style={styles.heardText} numberOfLines={1}>
                      {c.from}
                    </Text>
                  </View>
                  <Ionicons
                    name="arrow-forward"
                    size={16}
                    color={Colors.inkFaint}
                    style={styles.arrow}
                  />
                  <View style={[styles.pill, styles.meantPill]}>
                    <Text style={styles.meantText} numberOfLines={1}>
                      {c.to || '—'}
                    </Text>
                  </View>
                </View>
                <View style={styles.actions}>
                  <IconButton
                    icon="create-outline"
                    size={18}
                    onPress={() => openEdit(c.id, c.from, c.to)}
                    accessibilityLabel="Edit correction"
                  />
                  <IconButton
                    icon="trash-outline"
                    size={18}
                    color={Colors.accentRed}
                    onPress={() => onDelete(c.id, c.from)}
                    accessibilityLabel="Delete correction"
                  />
                </View>
              </View>
            </Card>
          ))}
        </View>
      )}

      {/* Add / Edit modal */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <Pressable style={styles.backdrop} onPress={closeModal}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={[Type.title, styles.sheetTitle]}>
              {editingId == null ? 'New correction' : 'Edit correction'}
            </Text>
            <Text style={[Type.bodySoft, styles.sheetSub]}>
              What the recogniser hears, and what you actually meant.
            </Text>

            <View style={styles.fields}>
              <TextField
                label="Heard"
                value={heard}
                onChangeText={setHeard}
                placeholder="cubanetes"
                autoCapitalize="none"
                autoFocus
              />
              <View style={styles.fieldArrow}>
                <Ionicons name="arrow-down" size={18} color={Colors.inkFaint} />
              </View>
              <TextField
                label="Meant"
                value={meant}
                onChangeText={setMeant}
                placeholder="Kubernetes"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.sheetActions}>
              <GhostButton label="Cancel" onPress={closeModal} style={styles.flexBtn} />
              <PrimaryButton
                label="Save"
                icon="checkmark"
                onPress={onSave}
                disabled={!canSave}
                style={styles.flexBtn}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  explainCard: { marginTop: 4 },
  explainRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  explainIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: `${Colors.brand}26`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainText: { flex: 1 },

  list: { marginTop: 14, gap: 10 },
  itemCard: { paddingVertical: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pair: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
  },
  heardPill: {
    backgroundColor: Colors.surfaceVariant,
    borderColor: Colors.outline,
  },
  meantPill: {
    backgroundColor: `${Colors.brand}26`,
    borderColor: Colors.brand,
  },
  heardText: { color: Colors.inkSoft, fontSize: 14, fontWeight: '600' },
  meantText: { color: Colors.ink, fontSize: 14, fontWeight: '700' },
  arrow: { marginHorizontal: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  // Modal
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
    paddingBottom: 36,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.outline,
    marginBottom: 16,
  },
  sheetTitle: { fontSize: 22 },
  sheetSub: { marginTop: 6 },
  fields: { marginTop: 20, gap: 12 },
  fieldArrow: { alignItems: 'center' },
  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  flexBtn: { flex: 1 },
});
