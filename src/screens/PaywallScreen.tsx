/**
 * Mynah Pro — the premium upsell. A brand-accent hero, the feature list,
 * and a two-plan selector backed by RevenueCat.
 *
 * RevenueCat may be unconfigured at dev time (no API key / native module not
 * wired up yet), so EVERY `Purchases` call is wrapped in try/catch and the screen
 * gracefully falls back to static marketing plans. The fallback button never
 * fakes a purchase — it only explains that billing ships in the production build.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Purchases, { PurchasesPackage } from 'react-native-purchases';

import { useNav } from '@/navigation/nav';
import { useStore } from '@/store';
import { Colors, Radius } from '@/theme/colors';
import {
  Badge,
  Card,
  GhostButton,
  PrimaryButton,
  Screen,
  SectionTitle,
  Type,
  haptic,
} from '@/ui/kit';

// --- plan model --------------------------------------------------------------

/** A single selectable plan. `pkg` is null for static placeholders. */
interface PlanOption {
  id: string;
  title: string;
  price: string;
  cadence: string;
  caption: string;
  badge?: string;
  pkg: PurchasesPackage | null;
}

/** Static plans shown when RevenueCat has no offerings (dev / unconfigured). */
const PLACEHOLDER_PLANS: PlanOption[] = [
  {
    id: 'placeholder.monthly',
    title: 'Monthly',
    price: '$4.99',
    cadence: 'per month',
    caption: 'Billed monthly, cancel anytime',
    pkg: null,
  },
  {
    id: 'placeholder.annual',
    title: 'Annual',
    price: '$29.99',
    cadence: 'per year',
    caption: 'Billed yearly — save 50%',
    badge: 'BEST VALUE',
    pkg: null,
  },
];

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'sparkles', text: 'AI Smart Formatting (grammar & tone)' },
  { icon: 'time', text: 'Unlimited dictation history' },
  { icon: 'globe', text: 'Priority on-device languages' },
  { icon: 'extension-puzzle', text: 'Custom snippets, vocabulary & corrections without limits' },
  { icon: 'heart', text: 'Support indie development' },
];

/** Human label for a RevenueCat package type. */
function planTitle(pkg: PurchasesPackage): string {
  switch (String(pkg.packageType)) {
    case 'ANNUAL':
      return 'Annual';
    case 'MONTHLY':
      return 'Monthly';
    case 'WEEKLY':
      return 'Weekly';
    case 'LIFETIME':
      return 'Lifetime';
    case 'SIX_MONTH':
      return '6 Months';
    case 'THREE_MONTH':
      return '3 Months';
    case 'TWO_MONTH':
      return '2 Months';
    default:
      return pkg.product.title || 'Subscription';
  }
}

/** Billing cadence label for a RevenueCat package type. */
function planCadence(pkg: PurchasesPackage): string {
  switch (String(pkg.packageType)) {
    case 'ANNUAL':
      return 'per year';
    case 'MONTHLY':
      return 'per month';
    case 'WEEKLY':
      return 'per week';
    case 'LIFETIME':
      return 'one-time';
    default:
      return '';
  }
}

/** Map a RevenueCat package into our display model. */
function toPlanOption(pkg: PurchasesPackage): PlanOption {
  const type = String(pkg.packageType);
  return {
    id: pkg.identifier,
    title: planTitle(pkg),
    price: pkg.product.priceString,
    cadence: planCadence(pkg),
    caption: pkg.product.description || (type === 'ANNUAL' ? 'Best long-term value' : 'Auto-renewing subscription'),
    badge: type === 'ANNUAL' ? 'BEST VALUE' : undefined,
    pkg,
  };
}

/** Pick a sensible default selection (the best-value / annual plan). */
function defaultSelected(plans: PlanOption[]): string {
  const best = plans.find((p) => p.badge) ?? plans.find((p) => /annual/i.test(p.id));
  return (best ?? plans[0])?.id ?? '';
}

// --- screen ------------------------------------------------------------------

export function PaywallScreen() {
  const { premium, setPremium } = useStore();
  const { pop } = useNav();

  const [plans, setPlans] = useState<PlanOption[]>(PLACEHOLDER_PLANS);
  const [usingPlaceholders, setUsingPlaceholders] = useState(true);
  const [selectedId, setSelectedId] = useState<string>(defaultSelected(PLACEHOLDER_PLANS));
  const [busy, setBusy] = useState(false);

  // Try to load real offerings; on any failure keep the placeholders.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const offerings = await Purchases.getOfferings();
        const pkgs = offerings?.current?.availablePackages ?? [];
        if (!active || pkgs.length === 0) return;
        const real = pkgs.map(toPlanOption);
        setPlans(real);
        setUsingPlaceholders(false);
        setSelectedId(defaultSelected(real));
      } catch {
        // RevenueCat unconfigured — stay on placeholders, never crash.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selected = plans.find((p) => p.id === selectedId) ?? plans[0];

  const onSubscribe = async () => {
    if (busy || !selected) return;

    // Placeholder mode: nothing to buy — be honest, don't fake it.
    if (!selected.pkg) {
      Alert.alert('Mynah Pro', 'Subscriptions are enabled in the production build.');
      return;
    }

    setBusy(true);
    try {
      await Purchases.purchasePackage(selected.pkg);
      // A successful purchase grants Pro regardless of entitlement naming.
      setPremium(true);
      haptic.success();
      pop();
    } catch (e: unknown) {
      const err = e as { userCancelled?: boolean; message?: string };
      // A user-initiated cancel is not an error worth alerting about.
      if (!err?.userCancelled) {
        haptic.warning();
        Alert.alert('Purchase failed', err?.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const info = await Purchases.restorePurchases();
      const active = info?.entitlements?.active ?? {};
      if (Object.keys(active).length > 0) {
        setPremium(true);
        haptic.success();
        Alert.alert('Welcome back', 'Your Mynah Pro subscription has been restored.');
        pop();
      } else {
        Alert.alert('Nothing to restore', 'We couldn’t find an active subscription on this account.');
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      Alert.alert('Restore failed', err?.message || 'Couldn’t restore purchases. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Mynah Pro" onBack={pop}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="sparkles" size={30} color="#fff" />
        </View>
        <Text style={styles.heroTitle}>Go Pro</Text>
        <Text style={styles.heroSubtitle}>Unlock the full Mynah experience.</Text>
      </View>

      {premium ? (
        <ProActiveCard onDone={pop} />
      ) : (
        <>
          {/* Features */}
          <SectionTitle>What you get</SectionTitle>
          <Card>
            {FEATURES.map((f, i) => (
              <View key={f.text} style={[styles.featureRow, i === FEATURES.length - 1 && { paddingBottom: 0 }]}>
                <View style={styles.check}>
                  <Ionicons name="checkmark" size={15} color={Colors.brand} />
                </View>
                <Text style={[Type.body, styles.featureText]}>{f.text}</Text>
              </View>
            ))}
          </Card>

          {/* Plan selector */}
          <SectionTitle>Choose your plan</SectionTitle>
          <View style={styles.plans}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                selected={plan.id === selectedId}
                onPress={() => {
                  haptic.tap();
                  setSelectedId(plan.id);
                }}
              />
            ))}
          </View>

          {usingPlaceholders ? (
            <View style={styles.noteRow}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.inkFaint} />
              <Text style={styles.note}>Billing is configured in the production build.</Text>
            </View>
          ) : null}

          {/* Actions */}
          <PrimaryButton
            label="Start free trial"
            icon="sparkles"
            onPress={onSubscribe}
            loading={busy}
            style={{ marginTop: 18 }}
          />
          <GhostButton
            label="Restore purchases"
            icon="refresh"
            onPress={onRestore}
            style={{ marginTop: 12 }}
          />
          <GhostButton label="Maybe later" onPress={pop} style={{ marginTop: 10 }} />

          <Text style={styles.legal}>
            Subscriptions renew automatically unless cancelled at least 24 hours before the end of the
            current period. Manage or cancel anytime in your App Store settings.
          </Text>
        </>
      )}
    </Screen>
  );
}

// --- pieces ------------------------------------------------------------------

function PlanCard({
  plan,
  selected,
  onPress,
}: {
  plan: PlanOption;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.planWrap, pressed && { opacity: 0.85 }]}>
      <View style={[styles.plan, selected && styles.planSelected]}>
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </View>
        <View style={styles.planText}>
          <View style={styles.planTitleRow}>
            <Text style={Type.label}>{plan.title}</Text>
            {plan.badge ? <Badge label={plan.badge} tone="amber" /> : null}
          </View>
          <Text style={[Type.bodySoft, { marginTop: 2 }]}>{plan.caption}</Text>
        </View>
        <View style={styles.priceCol}>
          <Text style={styles.price}>{plan.price}</Text>
          {plan.cadence ? <Text style={styles.cadence}>{plan.cadence}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

function ProActiveCard({ onDone }: { onDone: () => void }) {
  return (
    <>
      <Card style={{ marginTop: 18, alignItems: 'center' }}>
        <View style={styles.proBadge}>
          <Ionicons name="checkmark-circle" size={34} color={Colors.success} />
        </View>
        <Text style={[Type.title, { fontSize: 22, marginTop: 12 }]}>You’re Pro 🎉</Text>
        <Text style={[Type.bodySoft, { textAlign: 'center', marginTop: 6 }]}>
          Every premium feature is unlocked. Thank you for supporting Mynah!
        </Text>
      </Card>
      <PrimaryButton label="Done" icon="checkmark" onPress={onDone} style={{ marginTop: 18 }} />
    </>
  );
}

// --- styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  hero: {
    backgroundColor: Colors.brand,
    borderRadius: Radius.card,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 4,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginTop: 14 },
  heroSubtitle: { color: 'rgba(255,255,255,0.9)', fontSize: 15, marginTop: 4, textAlign: 'center' },

  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(124,92,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { flex: 1 },

  plans: { gap: 12 },
  planWrap: {},
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: Colors.outline,
    padding: 16,
  },
  planSelected: { borderColor: Colors.brand, backgroundColor: 'rgba(124,92,255,0.08)' },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: Colors.brand, backgroundColor: Colors.brand },
  planText: { flex: 1 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priceCol: { alignItems: 'flex-end' },
  price: { color: Colors.ink, fontSize: 18, fontWeight: '800' },
  cadence: { color: Colors.inkFaint, fontSize: 12, marginTop: 2 },

  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 2 },
  note: { color: Colors.inkFaint, fontSize: 12, flex: 1 },

  legal: {
    color: Colors.inkFaint,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 18,
    paddingHorizontal: 6,
  },

  proBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(67,230,193,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
