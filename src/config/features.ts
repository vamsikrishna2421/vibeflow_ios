/**
 * Build-time feature flags.
 *
 * PRO_ENABLED gates every VibeFlow Pro purchase entry point — the Settings upgrade
 * banner and the first-run demo's "Unlock Pro" CTA. It is FALSE for the initial
 * free-tier App Store launch: the subscription / RevenueCat offering isn't live
 * yet, and Apple rejects any paywall that can't complete a purchase (Guideline
 * 3.1.1 / 2.1). Flip this to true in the release that ships the working
 * subscription, and the paywall entry points light back up unchanged.
 */
export const PRO_ENABLED = false;
