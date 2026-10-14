import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Feather } from "lucide-react";

interface ProtectedRouteProps {
  children?: React.ReactNode;
  requiredRole?: "AUTHOR" | "ADMIN";
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredRole,
}) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50">
        <div className="w-12 h-12 rounded-xl bg-brand-800 text-emerald-300 flex items-center justify-center shadow-md animate-pulse">
          <Feather className="w-6 h-6" />
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-stone-500">
          Loading BookLeaf Author Portal...
        </p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-xl font-bold text-stone-900">Access Restricted</h2>
        <p className="text-sm text-stone-500 mt-2">
          Your account role ({user.role}) does not have permission to view this section.
        </p>
      </div>
    );
  }

  return children ? <>{children}</> : null;
};
