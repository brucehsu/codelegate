import { useState } from "react";
import type { AgentId } from "../../../types";
import { agentCatalog } from "../../../constants";
import { agentIconById } from "../AgentIcon/agentIcons";
import styles from "./AgentIconStack.module.css";

const classById: Record<AgentId, string> = {
  claude: styles.agentClaude,
  codex: styles.agentCodex,
};

interface AgentIconStackProps {
  activeAgent: AgentId;
}

interface SwapState {
  active: AgentId;
  from: AgentId | null;
  nonce: number;
}

export default function AgentIconStack({ activeAgent }: AgentIconStackProps) {
  // Track the previous active agent across renders so a change can replay the swap
  // animation. Updating during render (React's "store info from previous renders"
  // pattern) keeps the new icon from flashing in its resting spot before animating.
  const [swap, setSwap] = useState<SwapState>({ active: activeAgent, from: null, nonce: 0 });

  if (swap.active !== activeAgent) {
    setSwap((prev) => ({ active: activeAgent, from: prev.active, nonce: prev.nonce + 1 }));
  }

  const { from, nonce } = swap;
  // nonce === 0 is the initial mount, which must not animate.
  const animating = nonce > 0;

  return (
    <span className={styles.stack} aria-hidden="true">
      {agentCatalog.map((agent) => {
        const isActive = agent.id === activeAgent;
        const animationClass = !animating
          ? ""
          : isActive
            ? styles.swapToFront
            : agent.id === from
              ? styles.swapToBack
              : "";
        const classes = [
          styles.icon,
          isActive ? styles.front : styles.back,
          classById[agent.id],
          animationClass,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span key={`${agent.id}:${nonce}`} className={classes}>
            {agentIconById[agent.id]}
          </span>
        );
      })}
    </span>
  );
}
