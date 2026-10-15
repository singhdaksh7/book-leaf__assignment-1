import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  hoverable = false,
  ...props
}) => {
  return (
    <div
      className={`bg-white rounded-xl border border-stone-200/80 shadow-card transition-all duration-200 ${
        hoverable ? "hover:shadow-elevated hover:border-stone-300" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<{
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}> = ({ title, subtitle, action, className = "", children }) => {
  if (children) {
    return (
      <div className={`px-6 py-4 border-b border-stone-100 flex items-center justify-between ${className}`}>
        {children}
      </div>
    );
  }

  return (
    <div className={`px-6 py-4 border-b border-stone-100 flex items-center justify-between gap-4 ${className}`}>
      <div>
        {title && <h3 className="text-base font-semibold text-stone-900 tracking-tight">{title}</h3>}
        {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
};

export const CardContent: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = "" }) => {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>;
};

export const CardFooter: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = "" }) => {
  return (
    <div className={`px-6 py-3.5 bg-stone-50/50 border-t border-stone-100 rounded-b-xl flex items-center justify-between text-xs text-stone-500 ${className}`}>
      {children}
    </div>
  );
};
