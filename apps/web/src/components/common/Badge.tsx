import React from "react";

export type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "indigo";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  dot?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "default",
  size = "md",
  dot = false,
  className = "",
}) => {
  const variantStyles: Record<BadgeVariant, { badge: string; dot: string }> = {
    default: {
      badge: "bg-stone-100 text-stone-800 border-stone-200",
      dot: "bg-stone-400",
    },
    success: {
      badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
      dot: "bg-emerald-500",
    },
    warning: {
      badge: "bg-amber-50 text-amber-800 border-amber-200",
      dot: "bg-amber-500",
    },
    danger: {
      badge: "bg-red-50 text-red-800 border-red-200",
      dot: "bg-red-500",
    },
    info: {
      badge: "bg-sky-50 text-sky-800 border-sky-200",
      dot: "bg-sky-500",
    },
    neutral: {
      badge: "bg-slate-100 text-slate-700 border-slate-200",
      dot: "bg-slate-400",
    },
    indigo: {
      badge: "bg-brand-50 text-brand-800 border-brand-200",
      dot: "bg-brand-500",
    },
  };

  const sizeStyles = {
    sm: "px-2 py-0.5 text-xs font-medium",
    md: "px-2.5 py-1 text-xs font-medium",
  };

  const { badge, dot: dotColor } = variantStyles[variant] || variantStyles.default;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${badge} ${sizeStyles[size]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />}
      {children}
    </span>
  );
};

export const StatusBadge: React.FC<{ status: string; className?: string }> = ({
  status,
  className = "",
}) => {
  const normalized = status.toUpperCase();

  switch (normalized) {
    case "PUBLISHED":
      return (
        <Badge variant="success" dot className={className}>
          Published
        </Badge>
      );
    case "IN_REVIEW":
      return (
        <Badge variant="warning" dot className={className}>
          In Review
        </Badge>
      );
    case "DRAFT_TYPESETTING":
    case "DRAFT":
      return (
        <Badge variant="neutral" dot className={className}>
          Drafting
        </Badge>
      );
    case "OPEN":
      return (
        <Badge variant="info" dot className={className}>
          Open
        </Badge>
      );
    case "IN_PROGRESS":
      return (
        <Badge variant="warning" dot className={className}>
          In Progress
        </Badge>
      );
    case "RESOLVED":
      return (
        <Badge variant="success" dot className={className}>
          Resolved
        </Badge>
      );
    case "CLOSED":
      return (
        <Badge variant="neutral" dot className={className}>
          Closed
        </Badge>
      );
    case "CRITICAL":
      return (
        <Badge variant="danger" dot className={className}>
          Critical
        </Badge>
      );
    case "HIGH":
      return (
        <Badge variant="danger" dot className={className}>
          High
        </Badge>
      );
    case "MEDIUM":
      return (
        <Badge variant="warning" dot className={className}>
          Medium
        </Badge>
      );
    case "LOW":
      return (
        <Badge variant="neutral" dot className={className}>
          Low
        </Badge>
      );
    default:
      return (
        <Badge variant="neutral" className={className}>
          {status}
        </Badge>
      );
  }
};
