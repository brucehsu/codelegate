import type { AgentId } from "../../types";
import { agentCatalog } from "../../constants";
import { ClaudeIconIcon, OpenaiIconIcon } from "@codelegate/shared/icons";
import styles from "./AgentPicker.module.css";

interface AgentPickerProps {
  selected: AgentId;
  onSelect: (agent: AgentId) => void;
}

function ClaudeLogo() {
  return <ClaudeIconIcon color="currentColor" strokeWidth={0} />;
}

function CodexLogo() {
  return <OpenaiIconIcon color="#ffffff" strokeWidth={6} />;
}

const iconById: Record<AgentId, JSX.Element> = {
  claude: <ClaudeLogo />,
  codex: <CodexLogo />,
};

export default function AgentPicker({ selected, onSelect }: AgentPickerProps) {
  return (
    <div className={styles.picker}>
      {agentCatalog.map((agent) => (
        <button
          key={agent.id}
          type="button"
          className={`${styles.card} ${selected === agent.id ? styles.cardActive : ""}`}
          onClick={() => onSelect(agent.id)}
        >
          <span className={`${styles.logo} ${styles[agent.id]}`}>{iconById[agent.id]}</span>
          <span className={styles.label}>{agent.label}</span>
        </button>
      ))}
    </div>
  );
}
