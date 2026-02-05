export type ShortcutModifierKey = "Ctrl" | "Shift" | "Alt" | "Meta";

const modifierOrder: ShortcutModifierKey[] = ["Ctrl", "Shift", "Alt", "Meta"];
const defaultShortcutModifier = "Alt";

const aliasMap: Record<string, ShortcutModifierKey> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
};

export function getShortcutModifierTokens(value?: string): ShortcutModifierKey[] {
  const source = value ?? "";
  const parts = source
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  const found = new Set<ShortcutModifierKey>();
  parts.forEach((part) => {
    const mapped = aliasMap[part];
    if (mapped) {
      found.add(mapped);
    }
  });
  return modifierOrder.filter((token) => found.has(token));
}

export function normalizeShortcutModifier(value?: string): string {
  const tokens = getShortcutModifierTokens(value);
  if (tokens.length === 0) {
    return defaultShortcutModifier;
  }
  return tokens.join("+");
}

export function formatShortcutModifier(value?: string): string {
  const tokens = getShortcutModifierTokens(normalizeShortcutModifier(value));
  return tokens.join(" + ");
}

export function buildShortcutCombo(modifier: string | undefined, keyCode: string): string {
  return `${normalizeShortcutModifier(modifier)}+${keyCode}`;
}

export function matchesShortcutModifierState(
  event: Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
  modifier: string | undefined
): boolean {
  const tokens = getShortcutModifierTokens(normalizeShortcutModifier(modifier));
  const required = {
    ctrl: tokens.includes("Ctrl"),
    shift: tokens.includes("Shift"),
    alt: tokens.includes("Alt"),
    meta: tokens.includes("Meta"),
  };
  return (
    event.ctrlKey === required.ctrl &&
    event.shiftKey === required.shift &&
    event.altKey === required.alt &&
    event.metaKey === required.meta
  );
}

export function modifierFromKeyboardEvent(
  event: Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">
): string | null {
  const tokens: ShortcutModifierKey[] = [];
  if (event.ctrlKey) {
    tokens.push("Ctrl");
  }
  if (event.shiftKey) {
    tokens.push("Shift");
  }
  if (event.altKey) {
    tokens.push("Alt");
  }
  if (event.metaKey) {
    tokens.push("Meta");
  }
  if (tokens.length === 0) {
    return null;
  }
  return tokens.join("+");
}

