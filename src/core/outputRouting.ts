/**
 * Pure routing decision: should finished text be *inserted* into a focused field
 * or *copied* to the clipboard? Port of Android `:core` `OutputRouting`.
 *
 * On iOS the app never has a live editable target (the keyboard, which does, can't
 * record), so the app path is effectively CLIPBOARD + App-Group hand-off. This is
 * kept for parity and for any future Action-button / Shortcuts insert path.
 */
export type RoutingTarget = 'TYPE' | 'CLIPBOARD';
export type RoutingMode = 'AUTO' | 'TYPE' | 'CLIPBOARD';

export function decideTarget(mode: RoutingMode, hasEditableTarget: boolean): RoutingTarget {
  switch (mode) {
    case 'TYPE':
      return 'TYPE';
    case 'CLIPBOARD':
      return 'CLIPBOARD';
    default:
      return hasEditableTarget ? 'TYPE' : 'CLIPBOARD';
  }
}

export function modeFromString(value: string | null | undefined): RoutingMode {
  switch (value?.toLowerCase().trim()) {
    case 'type':
      return 'TYPE';
    case 'clipboard':
      return 'CLIPBOARD';
    default:
      return 'AUTO';
  }
}

/** Add a single trailing space so back-to-back dictations don't run together. */
export function withTrailingSpace(text: string, enabled: boolean): string {
  if (!enabled || text.length === 0) return text;
  return /\s$/.test(text) ? text : text + ' ';
}
