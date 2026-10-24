import { HTMLAttributes } from "react";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  noPadding?: boolean;
}

/**
 * Archetype N · Dock Card Container.
 * Large 24px corner radius, crisp white surface, deep navy ink typography.
 */
export default function Panel({
  elevated = false,
  noPadding = false,
  children,
  className = "",
  style,
  ...props
}: PanelProps) {
  return (
    <div
      className={[
        "relative rounded-[24px] overflow-hidden transition-all duration-200",
        noPadding ? "p-0" : "p-6",
        elevated
          ? "bg-[var(--bg-elevated)] border-2 border-[var(--border-default)] shadow-[0_12px_28px_rgba(11,27,77,0.12)]"
          : "bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[0_8px_24px_rgba(11,27,77,0.08)]",
        "text-[var(--text-on-card)]",
        className,
      ].join(" ")}
      style={style}
      {...props}
    >
      {children}
    </div>
  );
}
