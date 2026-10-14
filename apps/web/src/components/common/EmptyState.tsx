import React from "react";
import { BookOpen } from "lucide-react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center bg-stone-50/50 rounded-xl border border-dashed border-stone-300 ${className}`}
    >
      <div className="w-12 h-12 rounded-full bg-white border border-stone-200 flex items-center justify-center text-stone-500 shadow-sm mb-4">
        {icon || <BookOpen className="w-6 h-6 text-stone-400" />}
      </div>
      <h3 className="text-base font-semibold text-stone-800">{title}</h3>
      <p className="mt-1 text-sm text-stone-500 max-w-sm">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
};
