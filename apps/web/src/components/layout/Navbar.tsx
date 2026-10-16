import React from "react";
import { Link } from "react-router-dom";
import { Menu, Plus, Bell, BookOpen, LifeBuoy } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../common/Button";

interface NavbarProps {
  onToggleMobileNav: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleMobileNav }) => {
  const { user } = useAuth();

  return (
    <header className="h-16 bg-white border-b border-stone-200/80 sticky top-0 z-20 px-4 sm:px-6 flex items-center justify-between shadow-subtle">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMobileNav}
          className="lg:hidden p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg focus-ring"
          aria-label="Open mobile navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:block">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Publishing Workspace
          </span>
          <p className="text-sm font-semibold text-stone-900">
            {user?.authorProfile
              ? `Welcome back, ${user.authorProfile.name}`
              : "BookLeaf Author Workspace"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link to="/tickets/new">
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="w-4 h-4" />}
          >
            <span className="hidden sm:inline">New Support Ticket</span>
            <span className="sm:hidden">Ticket</span>
          </Button>
        </Link>

        {user?.authorProfile && (
          <div className="hidden md:flex items-center gap-2 pl-3 border-l border-stone-200 text-xs text-stone-600">
            <span className="font-mono bg-stone-100 px-2 py-1 rounded text-stone-700 font-medium">
              {user.authorProfile.externalAuthorId}
            </span>
          </div>
        )}
      </div>
    </header>
  );
};
