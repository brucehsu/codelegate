import { ClaudeIconIcon, OpenaiIconIcon } from "@codelegate/shared/icons";
import type { AgentId } from "../../../types";

// Single source of truth for the per-agent glyph. Exhaustive over AgentId, so
// adding an agent is a compile error until its icon is supplied here. The `color`
// is inherited from the consuming element (color: currentColor), letting each
// call site tint it via a CSS class.
export const agentIconById: Record<AgentId, JSX.Element> = {
  claude: <ClaudeIconIcon color="currentColor" strokeWidth={0} />,
  codex: <OpenaiIconIcon color="currentColor" strokeWidth={3.5} />,
};
