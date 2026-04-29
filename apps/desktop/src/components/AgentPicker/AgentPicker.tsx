import type { AgentAvailability, AgentId } from "../../types";
import { agentCatalog } from "../../constants";
import { ClaudeIconIcon, FactoryIconIcon, OpenaiIconIcon } from "@codelegate/shared/icons";
import styles from "./AgentPicker.module.css";

interface AgentPickerProps {
  selected: AgentId;
  availability: AgentAvailability;
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
  droid: <FactoryIconIcon />,
};

export default function AgentPicker({ selected, availability, onSelect }: AgentPickerProps) {
  return (
    <div className={styles.picker}>
      {agentCatalog.map((agent) => {
        const available = availability[agent.id] !== false;
        return (
          <button
            key={agent.id}
            type="button"
            className={`${styles.card} ${selected === agent.id ? styles.cardActive : ""} ${
              available ? "" : styles.cardDisabled
            }`}
            disabled={!available}
            onClick={() => onSelect(agent.id)}
          >
            <span className={`${styles.logo} ${styles[agent.id]}`}>{iconById[agent.id]}</span>
            <span className={styles.label}>{agent.label}</span>
          </button>
        );
      })}
    </div>
  );
}
