import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./CollapsibleSection.module.css";

interface CollapsibleSectionProps {
  title: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headerClassName?: string;
  toggleClassName?: string;
  titleClassName?: string;
  bodyClassName?: string;
  chevronClassName?: string;
  actionsClassName?: string;
  showChevron?: boolean;
}

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export default function CollapsibleSection({
  title,
  isOpen,
  onToggle,
  children,
  actions,
  className,
  headerClassName,
  toggleClassName,
  titleClassName,
  bodyClassName,
  chevronClassName,
  actionsClassName,
  showChevron = true,
}: CollapsibleSectionProps) {
  return (
    <div className={cx(styles.section, className)}>
      <div className={cx(styles.header, headerClassName)}>
        <button
          type="button"
          className={cx(styles.toggle, toggleClassName)}
          onClick={onToggle}
          aria-expanded={isOpen}
        >
          <span className={cx(styles.title, titleClassName)}>{title}</span>
          {showChevron ? (
            <span className={cx(styles.chevron, chevronClassName)} aria-hidden="true">
              {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          ) : null}
        </button>
        {actions ? <div className={cx(styles.actions, actionsClassName)}>{actions}</div> : null}
      </div>
      {isOpen ? <div className={cx(styles.body, bodyClassName)}>{children}</div> : null}
    </div>
  );
}
