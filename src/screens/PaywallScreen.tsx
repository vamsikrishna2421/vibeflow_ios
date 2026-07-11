/**
 * VibeFlow Pro — the premium upsell. A brand-accent hero, the feature list,
 * and a two-plan selector backed by RevenueCat.
 *
 * RevenueCat may be unconfigured at dev time (no API key / native module not
 * wired up yet), so EVERY `Purchases` call is wrapped in try/catch and the screen
 * gracefully falls back to static marketing plans. The fallback button never
 * fakes a purchase — it only explains that billing ships in the production build.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Purchases, { PurchasesPackage } from 'react-native-purchases';

import { useNav } from '@/navigation/nav';
import { useStore } from '@/store';
import { brandGradient, Colors, Radius } from '@/theme/colors';
import {
  Badge,
  Card,
  GhostButton,
  PrimaryButton,
  Screen,
  Type,
  haptic,
} from '@/ui/kit';

// --- plan model --------------------------------------------------------------

/** A single selectable plan. `pkg` is null for static placeholders. */
interface PlanOption {
  id: string;
  title: string;
  price: string;
  /** Anchor price shown struck through (early-bird marketing). */
  strikePrice?: string;
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
    price: '$0.99',
    strikePrice: '$4.99',
    cadence: 'per month',
    caption: 'Early-bird launch price — lock it in',
    badge: 'EARLY BIRD',
    pkg: null,
  },
  {
    id: 'placeholder.annual',
    title: 'Annual',
    // Early-bird annual — must stay BELOW 12× the monthly ($0.99) or "best value"
    // is a lie. $9.99/yr = $0.83/mo.
    price: '$9.99',
    cadence: 'per year',
    caption: '$0.83/mo · billed yearly',
    badge: 'BEST VALUE',
    pkg: null,
  },
];

// Short labels for the compact two-column grid.
const FEATURES: string[] = [
  'AI Smart Formatting',
  'Unlimited history',
  'Priority languages',
  'Snippets & vocabulary',
  'Custom corrections',
  'Support indie dev',
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
  // Early-bird anchor: while the monthly launch price is under $2, show the
  // regular $4.99 struck through (USD only — a wrong-currency anchor is worse
  // than none).
  const earlyBird =
    type === 'MONTHLY' && pkg.product.currencyCode === 'USD' && pkg.product.price > 0 && pkg.product.price < 2;
  return {
    id: pkg.identifier,
    title: planTitle(pkg),
    price: pkg.product.priceString,
    strikePrice: earlyBird ? '$4.99' : undefined,
    cadence: planCadence(pkg),
    caption: earlyBird
      ? 'Early-bird launch price — lock it in'
      : pkg.product.description || (type === 'ANNUAL' ? 'Best long-term value' : 'Auto-renewing subscription'),
    badge: earlyBird ? 'EARLY BIRD' : type === 'ANNUAL' ? 'BEST VALUE' : undefined,
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
      Alert.alert('VibeFlow Pro', 'Subscriptions are enabled in the production build.');
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
        Alert.alert('Welcome back', 'Your VibeFlow Pro subscription has been restored.');
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
    <Screen title="VibeFlow Pro" onBack={pop} scroll={false}>
      {premium ? (
        <ProActiveCard onDone={pop} />
      ) : (
        <View style={styles.body}>
          {/* Hero — compact gradient banner */}
          <LinearGradient
            colors={[...brandGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroIcon}>
              <Ionicons name="sparkles" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Go Pro</Text>
              <Text style={styles.heroSubtitle}>Unlock the full VibeFlow experience.</Text>
            </View>
          </LinearGradient>

          {/* Features — two columns */}
          <Text style={styles.sectionLabel}>WHAT YOU GET</Text>
          <View style={styles.featGrid}>
            {FEATURES.map((f) => (
              <View key={f} style={styles.featRow}>
                <LinearGradient
                  colors={['#A855F7', '#56B6FF']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.check}
                >
                  <Ionicons name="checkmark" size={13} color="#fff" />
                </LinearGradient>
                <Text style={styles.featText} numberOfLines={1}>
                  {f}
                </Text>
              </View>
            ))}
          </View>

          {/* Plans — side by side */}
          <Text style={styles.sectionLabel}>CHOOSE YOUR PLAN</Text>
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

          {/* CTA — gradient. Only promise a trial when real billing is wired. */}
          <Pressable
            onPress={onSubscribe}
            disabled={busy}
            style={({ pressed }) => [styles.ctaWrap, pressed && { opacity: 0.92 }]}
          >
            <LinearGradient
              colors={['#8B5CF6', '#5FA8FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.cta}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="#fff" />
                  <Text style={styles.ctaText}>
                    {usingPlaceholders ? 'Get VibeFlow Pro' : 'Start free trial'}
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>

          <View style={styles.actionRow}>
            <GhostButton label="Restore" icon="refresh" onPress={onRestore} disabled={busy} style={styles.flexBtn} />
            <GhostButton label="Maybe later" onPress={pop} disabled={busy} style={styles.flexBtn} />
          </View>

          <Text style={styles.legal}>
            {usingPlaceholders ? 'Billing is enabled in the production build. ' : ''}
            Renews automatically; cancel anytime in your {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} settings.
          </Text>
        </View>
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
  const cadence = plan.cadence.includes('year')
    ? '/yr'
    : plan.cadence.includes('month')
    ? '/mo'
    : plan.cadence;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.planWrap, pressed && { opacity: 0.9 }]}>
      <View style={[styles.plan, selected && styles.planSelected]}>
        <View style={styles.planTop}>
          <Text style={styles.planName}>{plan.title}</Text>
          {plan.badge ? <Badge label={plan.badge} tone={plan.badge === 'BEST VALUE' ? 'brand' : 'amber'} /> : null}
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{plan.price}</Text>
          {plan.cadence ? <Text style={styles.cadence}>{cadence}</Text> : null}
          {plan.strikePrice ? <Text style={styles.strikePrice}>{plan.strikePrice}</Text> : null}
        </View>
        <Text style={styles.planCaption} numberOfLines={1}>
          {plan.caption}
        </Text>
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
          Every premium feature is unlocked. Thank you for supporting VibeFlow!
        </Text>
      </Card>
      <PrimaryButton label="Done" icon="checkmark" onPress={onDone} style={{ marginTop: 18 }} />
    </>
  );
}

// --- styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  body: { marginTop: 4 },

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: Radius.card,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { color: '#fff', fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  heroSubtitle: { color: 'rgba(255,255,255,0.92)', fontSize: 13, marginTop: 1 },

  sectionLabel: {
    color: Colors.inkFaint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 10,
  },
  featGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  featRow: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 },
  check: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  featText: { color: Colors.ink, fontSize: 13.5, flex: 1 },

  plans: { flexDirection: 'row', gap: 10 },
  planWrap: { flex: 1 },
  plan: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.outline,
    backgroundColor: Colors.surface,
    padding: 14,
  },
  planSelected: { borderColor: Colors.brand, backgroundColor: `${Colors.brand}14` },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  planName: { color: Colors.ink, fontSize: 15, fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, marginTop: 10 },
  price: { color: Colors.ink, fontSize: 22, fontWeight: '800' },
  cadence: { color: Colors.inkFaint, fontSize: 12, marginBottom: 2 },
  strikePrice: { color: Colors.inkFaint, fontSize: 12, textDecorationLine: 'line-through', marginBottom: 2 },
  planCaption: { color: Colors.inkSoft, fontSize: 12, marginTop: 6 },

  ctaWrap: { marginTop: 18 },
  cta: {
    height: 54,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  flexBtn: { flex: 1 },

  legal: {
    color: Colors.inkFaint,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 14,
    paddingHorizontal: 6,
  },

  proBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${Colors.success}24`,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
