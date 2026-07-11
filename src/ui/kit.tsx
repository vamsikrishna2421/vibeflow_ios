/**
 * VibeFlow UI kit — the premium, dark-first building blocks every screen shares,
 * so the app has one consistent rhythm and accent. Pure presentational components
 * built on the design tokens in `@/theme/colors`.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, brandGradient } from '@/theme/colors';

type IconName = keyof typeof Ionicons.glyphMap;

// --- haptics -----------------------------------------------------------------

export const haptic = {
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  success: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warning: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
};

// --- typography --------------------------------------------------------------

export const Type = StyleSheet.create({
  title: { color: Colors.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: Colors.inkSoft, fontSize: 15, lineHeight: 21 },
  body: { color: Colors.ink, fontSize: 16, lineHeight: 22 },
  bodySoft: { color: Colors.inkSoft, fontSize: 14, lineHeight: 20 },
  label: { color: Colors.ink, fontSize: 16, fontWeight: '600' },
  caption: { color: Colors.inkFaint, fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
});

// --- screen scaffold ---------------------------------------------------------

export function Screen({
  title,
  subtitle,
  onBack,
  right,
  scroll = true,
  padded = true,
  children,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const header = (title || onBack || right) && (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {onBack ? (
          <IconButton icon="chevron-back" onPress={onBack} accessibilityLabel="Back" />
        ) : (
          <View style={{ width: 40 }} />
        )}
        <View style={{ flex: 1 }} />
        {right ?? <View style={{ width: 40 }} />}
      </View>
      {title ? <Text style={[Type.title, { marginTop: 6 }]}>{title}</Text> : null}
      {subtitle ? <Text style={[Type.subtitle, { marginTop: 4 }]}>{subtitle}</Text> : null}
    </View>
  );

  const body = (
    <View style={padded ? styles.padded : undefined}>
      {header}
      {children}
    </View>
  );

  if (!scroll) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {body}
      </View>
    );
  }
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
    >
      {body}
    </ScrollView>
  );
}

// --- surfaces ----------------------------------------------------------------

export function Card({
  children,
  style,
  onPress,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padded?: boolean;
}) {
  const content = (
    <View style={[styles.card, padded && styles.cardPadded, style]}>{children}</View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {content}
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={[Type.caption, styles.sectionTitle]}>{String(children).toUpperCase()}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

// --- buttons -----------------------------------------------------------------

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled || loading) return;
        haptic.tap();
        onPress();
      }}
      disabled={disabled || loading}
      style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.9 : 1 }, style]}
    >
      <LinearGradient
        colors={[...brandGradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.primaryBtn}
      >
        {loading ? (
          <ActivityIndicator color={Colors.onBrand} />
        ) : (
          <View style={styles.btnInner}>
            {icon ? <Ionicons name={icon} size={18} color={Colors.onBrand} /> : null}
            <Text style={styles.primaryBtnText}>{label}</Text>
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  icon,
  tone = 'default',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const color = tone === 'danger' ? Colors.accentRed : Colors.ink;
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        haptic.tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.ghostBtn,
        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      <Text style={[styles.ghostBtnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  size = 22,
  color = Colors.ink,
  accessibilityLabel,
}: {
  icon: IconName;
  onPress: () => void;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={10}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

// --- rows --------------------------------------------------------------------

export function ToggleRow({
  icon,
  tint,
  label,
  subtitle,
  value,
  onValueChange,
  disabled,
}: {
  icon?: IconName;
  tint?: string;
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, disabled && { opacity: 0.5 }]}>
      {icon ? <RowIcon icon={icon} tint={tint} /> : null}
      <View style={styles.rowText}>
        <Text style={Type.label}>{label}</Text>
        {subtitle ? <Text style={[Type.bodySoft, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          haptic.tap();
          onValueChange(v);
        }}
        disabled={disabled}
        trackColor={{ false: Colors.outline, true: Colors.brand }}
        thumbColor="#fff"
        ios_backgroundColor={Colors.outline}
      />
    </View>
  );
}

export function NavRow({
  icon,
  tint,
  label,
  subtitle,
  value,
  onPress,
  danger,
}: {
  icon?: IconName;
  tint?: string;
  label: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const color = danger ? Colors.accentRed : Colors.ink;
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {icon ? <RowIcon icon={icon} tone={danger ? 'danger' : 'default'} tint={tint} /> : null}
      <View style={styles.rowText}>
        <Text style={[Type.label, { color }]}>{label}</Text>
        {subtitle ? <Text style={[Type.bodySoft, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[Type.bodySoft, { marginRight: 6 }]}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={Colors.inkFaint} />
    </Pressable>
  );
}

function RowIcon({
  icon,
  tone = 'default',
  tint,
}: {
  icon: IconName;
  tone?: 'default' | 'danger';
  tint?: string;
}) {
  const color = tint ?? (tone === 'danger' ? Colors.accentRed : Colors.brand);
  return (
    <View style={[styles.rowIcon, { backgroundColor: `${color}26` }]}>
      <Ionicons name={icon} size={18} color={color} />
    </View>
  );
}

// --- small pieces ------------------------------------------------------------

export function Chip({
  label,
  icon,
  onPress,
  selected,
  tone = 'default',
}: {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  selected?: boolean;
  tone?: 'default' | 'brand';
}) {
  const bg = selected || tone === 'brand' ? `${Colors.brand}2E` : Colors.surfaceVariant;
  const border = selected ? Colors.brand : Colors.outline;
  const fg = selected || tone === 'brand' ? Colors.ink : Colors.inkSoft;
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              haptic.tap();
              onPress();
            }
          : undefined
      }
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: bg, borderColor: border },
        pressed && styles.pressed,
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={fg} /> : null}
      <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Badge({ label, tone = 'brand' }: { label: string; tone?: 'brand' | 'amber' | 'muted' }) {
  const map = {
    brand: { bg: `${Colors.brand}2E`, fg: Colors.brand },
    amber: { bg: `${Colors.amber}29`, fg: Colors.amber },
    muted: { bg: Colors.surfaceVariant, fg: Colors.inkSoft },
  } as const;
  const c = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={Colors.brand} />
      </View>
      <Text style={[Type.label, { marginTop: 14 }]}>{title}</Text>
      <Text style={[Type.bodySoft, { textAlign: 'center', marginTop: 6 }]}>{message}</Text>
      {actionLabel && onAction ? (
        <GhostButton label={actionLabel} onPress={onAction} style={{ marginTop: 14 }} />
      ) : null}
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  autoFocus,
  autoCapitalize = 'none',
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={Type.caption}>{label.toUpperCase()}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.inkFaint}
        multiline={multiline}
        autoFocus={autoFocus}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={[styles.input, multiline && { minHeight: 96, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  padded: { paddingHorizontal: Spacing.gutter },
  header: { marginBottom: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  sectionTitle: { marginTop: 22, marginBottom: 10 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outline,
  },
  cardPadded: { padding: 16 },
  pressed: { opacity: 0.7 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.outline, marginVertical: 4 },

  primaryBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryBtnText: { color: Colors.onBrand, fontSize: 17, fontWeight: '700' },

  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: Colors.surfaceVariant,
  },
  ghostBtnText: { fontSize: 16, fontWeight: '600' },

  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceVariant,
  },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 14 },
  rowText: { flex: 1 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    borderWidth: 1,
    maxWidth: 240,
  },
  chipText: { fontSize: 14, fontWeight: '600' },

  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${Colors.brand}1F`,
    alignItems: 'center',
    justifyContent: 'center',
  },

  input: {
    backgroundColor: Colors.surfaceVariant,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outline,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.ink,
    fontSize: 16,
  },
});
