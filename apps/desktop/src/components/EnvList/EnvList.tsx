import { X } from "lucide-react";
import type { EnvVar } from "../../types";
import IconButton from "../ui/IconButton/IconButton";
import styles from "./EnvList.module.css";

interface EnvListProps {
  envVars: EnvVar[];
  onChange: (next: EnvVar[]) => void;
}

export default function EnvList({ envVars, onChange }: EnvListProps) {
  const updateVar = (index: number, field: keyof EnvVar, value: string) => {
    const next = envVars.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry));
    onChange(next);
  };

  const removeVar = (index: number) => {
    const next = envVars.filter((_, idx) => idx !== index);
    onChange(next.length > 0 ? next : [{ key: "", value: "" }]);
  };

  const addVar = () => {
    onChange([...envVars, { key: "", value: "" }]);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.list}>
        {envVars.map((entry, index) => (
          <div key={index} className={styles.row}>
            <input
              className={styles.input}
              placeholder="KEY"
              value={entry.key}
              onChange={(event) => updateVar(index, "key", event.target.value)}
            />
            <input
              className={styles.input}
              placeholder="value"
              value={entry.value}
              onChange={(event) => updateVar(index, "value", event.target.value)}
            />
            <IconButton
              aria-label="Remove"
              variant="ghost"
              tone="danger"
              size="sm"
              iconSize={32}
              onClick={() => removeVar(index)}
            >
              <X aria-hidden="true" />
            </IconButton>
          </div>
        ))}
      </div>
      <button type="button" className={styles.addButton} onClick={addVar}>
        Add variable
      </button>
    </div>
  );
}
