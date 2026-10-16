import React, { useState } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import { Feather, Lock, Mail, ArrowRight, ShieldCheck, User } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { Alert } from "../../components/common/Alert";

export const LoginPage: React.FC = () => {
  const { login, isMockMode, user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Demo credentials belong to the offline mock adapter only. Production builds and live-API runs start with empty fields.
  const demoEnabled = !import.meta.env.PROD && isMockMode;
  const [email, setEmail] = useState(demoEnabled ? "author@bookleafpublishing.test" : "");
  const [password, setPassword] = useState(demoEnabled ? "AuthorSecurePass123!" : "");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const from = (location.state as any)?.from?.pathname || "/dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    try {
      setIsLoading(true);
      const loggedInUser = await login({ email: email.trim(), password });
      const target = (location.state as any)?.from?.pathname || (loggedInUser.role === "ADMIN" ? "/admin/dashboard" : "/dashboard");
      navigate(target, { replace: true });
    } catch (err: any) {
      setErrorMessage(err.message || "Invalid email or password.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFillDemo = (demoType: "author" | "admin") => {
    if (demoType === "author") {
      setEmail("author@bookleafpublishing.test");
      setPassword("AuthorSecurePass123!");
    } else {
      setEmail("editorial.admin@bookleafpublishing.test");
      setPassword("AdminReviewerPass123!");
    }
    setErrorMessage(null);
  };

  // Already signed in: go to the role home (or where the user was heading) instead of showing the form again.
  if (!authLoading && user) {
    return <Navigate to={from !== "/dashboard" ? from : user.role === "ADMIN" ? "/admin/dashboard" : "/dashboard"} replace />;
  }

  return (
    <div className="min-h-screen bg-stone-100/70 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-800 text-emerald-300 shadow-md mb-4 border border-brand-700">
          <Feather className="w-6 h-6 text-emerald-300" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 font-editorial">
          BookLeaf Author Portal
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Sign in to access your publishing records, sales royalties, and editorial support.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-card border border-stone-200/80 rounded-2xl sm:px-10">
          {errorMessage && (
            <Alert variant="error" className="mb-5">
              {errorMessage}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <Input
              id="login-email"
              type="email"
              label="Author Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@publisher.com"
              leftIcon={<Mail className="w-4 h-4" />}
              autoComplete="email"
              required
            />

            <Input
              id="login-password"
              type="password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              leftIcon={<Lock className="w-4 h-4" />}
              autoComplete="current-password"
              required
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              isLoading={isLoading}
              className="w-full font-semibold shadow-sm"
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              Sign In to Portal
            </Button>
          </form>

          {/* Quick Demo Credentials for Reviewers (offline mock mode only) */}
          {demoEnabled && (
          <div className="mt-6 pt-6 border-t border-stone-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-3 text-center">
              Quick Reviewer Credentials
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleFillDemo("author")}
                className="flex items-center justify-center gap-1.5 p-2 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs text-stone-700 font-medium transition-colors"
              >
                <User className="w-3.5 h-3.5 text-brand-600" />
                Demo Author
              </button>
              <button
                type="button"
                onClick={() => handleFillDemo("admin")}
                className="flex items-center justify-center gap-1.5 p-2 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs text-stone-700 font-medium transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                Demo Admin
              </button>
            </div>
            <p className="mt-3 text-[11px] text-center text-stone-400">
              Operating with isolated synthetic mocks (API contracts compliant).
            </p>
          </div>
          )}
        </div>
      </div>
    </div>
  );
};
