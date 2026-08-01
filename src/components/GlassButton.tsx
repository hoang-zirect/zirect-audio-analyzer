import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import "./GlassButton.css";

export type GlassButtonSize = "sm" | "default" | "lg" | "icon";
export type GlassButtonVariant = "primary" | "secondary" | "danger" | "neutral";

export interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  contentClassName?: string;
  size?: GlassButtonSize;
  variant?: GlassButtonVariant;
  loading?: boolean;
}

const joinClassNames = (...classNames: Array<string | undefined | false>) =>
  classNames.filter(Boolean).join(" ");

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  {
    children,
    className,
    contentClassName,
    size = "default",
    variant = "neutral",
    loading = false,
    disabled,
    type = "button",
    "aria-busy": ariaBusy,
    ...buttonProps
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={joinClassNames(
        "glass-button",
        `glass-button--${size}`,
        `glass-button--${variant}`,
        loading && "glass-button--loading",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={ariaBusy ?? (loading ? true : undefined)}
      {...buttonProps}
    >
      <span className={joinClassNames("glass-button__content", contentClassName)}>
        {loading ? <span className="glass-button__spinner" aria-hidden="true" /> : null}
        {children}
      </span>
    </button>
  );
});

