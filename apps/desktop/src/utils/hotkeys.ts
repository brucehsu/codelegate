export interface HotkeyBinding {
  id: string;
  key?: string;
  code?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  handler: (event: KeyboardEvent) => void;
}

interface DefineHotkeyOptions {
  id: string;
  combo: string;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  handler: (event: KeyboardEvent) => void;
}

type HotkeyModifier = "ctrl" | "shift" | "alt" | "meta";

const modifierTokenMap: Record<string, HotkeyModifier> = {
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "alt",
  option: "alt",
  meta: "meta",
  cmd: "meta",
  command: "meta",
};

const codeTokenPattern =
  /^(?:Tab|Enter|Escape|Space|Backspace|Delete|Home|End|PageUp|PageDown|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Key[A-Z]|Digit[0-9]|Numpad[0-9])$/;

function parseHotkeyCombo(combo: string) {
  const parts = combo
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const parsed = {
    key: undefined as string | undefined,
    code: undefined as string | undefined,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  for (const part of parts) {
    const normalized = part.toLowerCase();
    const modifier = modifierTokenMap[normalized];
    if (modifier) {
      parsed[modifier] = true;
      continue;
    }

    if (parsed.key !== undefined || parsed.code !== undefined) {
      throw new Error(`Invalid hotkey combo "${combo}": multiple keys specified.`);
    }

    if (codeTokenPattern.test(part)) {
      parsed.code = part;
    } else {
      parsed.key = normalized;
    }
  }

  if (parsed.key === undefined && parsed.code === undefined) {
    throw new Error(`Invalid hotkey combo "${combo}": missing key.`);
  }

  return parsed;
}

export function defineHotkey({
  id,
  combo,
  preventDefault,
  stopPropagation,
  handler,
}: DefineHotkeyOptions): HotkeyBinding {
  return {
    id,
    ...parseHotkeyCombo(combo),
    preventDefault,
    stopPropagation,
    handler,
  };
}

export function matchesHotkey(event: KeyboardEvent, hotkey: HotkeyBinding) {
  if (hotkey.code !== undefined && event.code !== hotkey.code) {
    return false;
  }
  if (hotkey.key !== undefined) {
    const key = event.key.toLowerCase();
    if (key !== hotkey.key) {
      return false;
    }
  }
  if (hotkey.key === undefined && hotkey.code === undefined) {
    return false;
  }
  if (hotkey.ctrl !== undefined && hotkey.ctrl !== event.ctrlKey) {
    return false;
  }
  if (hotkey.shift !== undefined && hotkey.shift !== event.shiftKey) {
    return false;
  }
  if (hotkey.alt !== undefined && hotkey.alt !== event.altKey) {
    return false;
  }
  if (hotkey.meta !== undefined && hotkey.meta !== event.metaKey) {
    return false;
  }
  return true;
}

export function runHotkeys(event: KeyboardEvent, hotkeys: HotkeyBinding[]) {
  for (const hotkey of hotkeys) {
    if (!matchesHotkey(event, hotkey)) {
      continue;
    }
    if (hotkey.preventDefault) {
      event.preventDefault();
    }
    if (hotkey.stopPropagation) {
      event.stopPropagation();
    }
    hotkey.handler(event);
    return true;
  }
  return false;
}
