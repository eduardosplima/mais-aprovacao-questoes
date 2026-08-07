import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-card border border-borda rounded-card shadow-card ${className}`}
    >
      {children}
    </div>
  );
}
