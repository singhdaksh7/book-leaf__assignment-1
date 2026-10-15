import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  BookOpen,
  LayoutDashboard,
  LifeBuoy,
  PlusCircle,
  LogOut,
  Sparkles,
  ShieldCheck,
  Feather,
  Database,
  Layers,
  Inbox,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Badge } from "../common/Badge";

interface SidebarProps {
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onCloseMobile }) => {
  const { user, logout, isMockMode, setIsMockMode, login } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleSwitchRole = async (targetRole: "AUTHOR" | "ADMIN") => {
    if (targetRole === "ADMIN") {
      await login({
        email: "editorial.admin@bookleafpublishing.test",
        password: "AdminReviewerPass123!",
      });
      navigate("/admin/dashboard");
    } else {
      await login({
        email: "author@bookleafpublishing.test",
        password: "AuthorSecurePass123!",
      });
      navigate("/dashboard");
    }
    if (onCloseMobile) onCloseMobile();
  };

  const authorNavItems = [
    {
      to: "/dashboard",
      label: "Author Dashboard",
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      to: "/books",
      label: "My Books",
      icon: <BookOpen className="w-4 h-4" />,
    },
    {
      to: "/tickets",
      label: "Support Tickets",
      icon: <LifeBuoy className="w-4 h-4" />,
    },
    {
      to: "/tickets/new",
      label: "New Ticket",
      icon: <PlusCircle className="w-4 h-4" />,
    },
  ];

  const adminNavItems = [
    {
      to: "/admin/dashboard",
      label: "Admin Overview",
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      to: "/admin/queue",
      label: "Ticket Queue",
      icon: <Inbox className="w-4 h-4" />,
    },
    {
      to: "/books",
      label: "Browse Titles",
      icon: <BookOpen className="w-4 h-4" />,
    },
  ];

  const isAdmin = user?.role === "ADMIN";

  return (
    <aside className="w-64 h-full bg-slate-900 text-slate-100 flex flex-col border-r border-slate-800">
      {/* Brand Header */}
      <div className="p-6 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-700/80 border border-emerald-500/40 flex items-center justify-center text-emerald-200 shadow-inner">
            <Feather className="w-5 h-5 text-emerald-200" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
              BookLeaf
              <span
                className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                  isAdmin
                    ? "bg-amber-950 text-amber-400 border-amber-800/60"
                    : "bg-emerald-950 text-emerald-400 border-emerald-800/60"
                }`}
              >
                {isAdmin ? "Admin" : "Author"}
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">
              {isAdmin ? "Staff Editorial Console" : "Author & Royalty Portal"}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-5 space-y-1.5 overflow-y-auto">
        <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {isAdmin ? "Admin Navigation" : "Author Navigation"}
        </p>

        {(isAdmin ? adminNavItems : authorNavItems).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onCloseMobile}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? isAdmin
                    ? "bg-amber-900/50 text-amber-100 font-semibold border-l-2 border-amber-400 pl-[10px]"
                    : "bg-emerald-800/60 text-emerald-100 font-semibold border-l-2 border-emerald-400 pl-[10px]"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`
            }
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}

        {/* Portal Switcher Shortcut for Reviewers (Development Only) */}
        {!import.meta.env.PROD && (
          <div className="pt-4 mt-4 border-t border-slate-800">
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              Workspace Switcher (Dev)
            </p>
            <div className="grid grid-cols-2 gap-1.5 px-2">
              <button
                type="button"
                onClick={() => handleSwitchRole("AUTHOR")}
                className={`text-xs py-1.5 px-2 rounded font-medium text-center transition-colors ${
                  !isAdmin
                    ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/60"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Author
              </button>
              <button
                type="button"
                onClick={() => handleSwitchRole("ADMIN")}
                className={`text-xs py-1.5 px-2 rounded font-medium text-center transition-colors ${
                  isAdmin
                    ? "bg-amber-900/60 text-amber-200 border border-amber-700/60"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Admin
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Adapter / Mock Indicator */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-slate-400" />
            API Mode:
          </span>
          {!import.meta.env.PROD ? (
            <button
              onClick={() => setIsMockMode(!isMockMode)}
              title="Toggle between in-memory synthetic mock adapter and live backend API"
              className="text-[11px] font-mono underline hover:text-white text-slate-300"
            >
              {isMockMode ? "Synthetic Mocks" : "Live Backend"}
            </button>
          ) : (
            <span className="text-[11px] font-mono text-slate-300">Live API</span>
          )}
        </div>
        <div className="text-[11px] text-slate-400 leading-tight">
          {!import.meta.env.PROD && isMockMode ? (
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Isolated synthetic fixtures
            </span>
          ) : (
            <span className="text-sky-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              Connecting to /api/v1
            </span>
          )}
        </div>
      </div>

      {/* User Footer Profile */}
      <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-950/70">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-full border text-white flex items-center justify-center font-bold text-xs shrink-0 ${
              isAdmin
                ? "bg-amber-900 border-amber-600/50"
                : "bg-emerald-900 border-emerald-600/40 text-emerald-200"
            }`}
          >
            {user?.authorProfile?.name
              ? user.authorProfile.name.charAt(0)
              : user?.email.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white truncate">
              {user?.authorProfile?.name || user?.email}
            </p>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              {isAdmin ? "Staff Admin" : user?.authorProfile?.externalAuthorId}
            </p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          title="Sign out of portal"
          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors focus-ring"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
