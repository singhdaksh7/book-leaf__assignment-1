import React from "react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: string;
    isPositive?: boolean;
    label?: string;
  };
  accentColor?: "emerald" | "amber" | "indigo" | "sky" | "slate";
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  trend,
  accentColor = "emerald",
  className = "",
}) => {
  const accentBorders = {
    emerald: "border-l-emerald-600",
    amber: "border-l-amber-500",
    indigo: "border-l-brand-600",
    sky: "border-l-sky-600",
    slate: "border-l-slate-600",
  };

  const iconBg = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    indigo: "bg-brand-50 text-brand-700",
    sky: "bg-sky-50 text-sky-700",
    slate: "bg-slate-50 text-slate-700",
  };

  return (
    <div
      className={`bg-white rounded-xl border border-stone-200/80 p-5 shadow-card hover:shadow-elevated transition-all border-l-4 ${accentBorders[accentColor]} ${className}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            {title}
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-stone-900 font-sans">
            {value}
          </p>
        </div>
        {icon && (
          <div className={`p-2.5 rounded-lg ${iconBg[accentColor]}`}>
            {icon}
          </div>
        )}
      </div>

      {(subtitle || trend) && (
        <div className="mt-3 flex items-center gap-2 text-xs text-stone-500 pt-2 border-t border-stone-100">
          {trend && (
            <span
              className={`font-semibold ${
                trend.isPositive ? "text-emerald-700" : "text-amber-700"
              }`}
            >
              {trend.value}
            </span>
          )}
          <span>{trend?.label || subtitle}</span>
        </div>
      )}
    </div>
  );
};
