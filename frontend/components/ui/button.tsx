import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "default" | "small";
}

export function Button({ className, variant = "primary", size = "default", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn("button", `button--${variant}`, size === "small" && "button--small", className)}
      {...props}
    />
  );
}
