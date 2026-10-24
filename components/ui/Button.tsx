"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const sizeClasses: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-[12px] min-h-[36px]",
  md: "px-5 py-2.5 text-[14px] min-h-[44px]",
  lg: "px-7 py-3.5 text-[16px] min-h-[52px]",
};

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-ink)] font-bold shadow-[0_4px_12px_rgba(255,210,63,0.3)] hover:brightness-105 active:scale-[0.98]",
  secondary:
    "bg-[var(--bg-surface)] text-[var(--text-on-card)] border border-[var(--border-default)] font-semibold hover:bg-[var(--bg-elevated)] active:scale-[0.98]",
  ghost:
    "bg-transparent text-current border border-white/20 hover:bg-white/10 active:scale-[0.98]",
  danger:
    "bg-red-50 text-[var(--danger)] border border-red-200 font-semibold hover:bg-red-100 active:scale-[0.98]",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled = false,
      children,
      className = "",
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          "inline-flex items-center justify-center gap-2 rounded-full",
          "tracking-[-0.01em] transition-all duration-150 select-none",
          "cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none",
          sizeClasses[size],
          variantClasses[variant],
          className,
        ].join(" ")}
        {...props}
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>{children}</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
