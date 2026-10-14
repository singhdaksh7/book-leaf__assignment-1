import React from "react";
import { AlertCircle, CheckCircle, Info, AlertTriangle } from "lucide-react";

interface AlertProps {
  variant?: "info" | "success" | "warning" | "error";
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  variant = "info",
  title,
  children,
  action,
  className = "",
}) => {
  const styles = {
    info: {
      wrapper: "bg-sky-50 border-sky-200 text-sky-900",
      icon: <Info className="w-5 h-5 text-sky-600 shrink-0" />,
    },
    success: {
      wrapper: "bg-emerald-50 border-emerald-200 text-emerald-900",
      icon: <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />,
    },
    warning: {
      wrapper: "bg-amber-50 border-amber-200 text-amber-900",
      icon: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />,
    },
    error: {
      wrapper: "bg-red-50 border-red-200 text-red-900",
      icon: <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />,
    },
  };

  const current = styles[variant];

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 p-4 rounded-xl border text-sm shadow-subtle ${current.wrapper} ${className}`}
    >
      {current.icon}
      <div className="flex-1">
        {title && <h4 className="font-semibold text-sm mb-0.5">{title}</h4>}
        <div className="text-xs leading-relaxed opacity-90">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};
