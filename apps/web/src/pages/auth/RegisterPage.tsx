import React, { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { passwordPolicyIssues, PASSWORD_MIN_LENGTH } from "@bookleaf/contracts";
import { ArrowRight, Check, CheckCircle2, Eye, EyeOff, Feather, Lock, Mail, User as UserIcon, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { ApiClientError } from "../../api";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { Alert } from "../../components/common/Alert";

type Field = "name" | "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<Field, string>>;

const fieldOrder: Field[] = ["name", "email", "password", "confirmPassword"];
const emailSchema = z.string().trim().email();

function validate(values: Record<Field, string>): FieldErrors {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  if (name.length < 2) errors.name = "Enter your full name.";
  else if (name.length > 100) errors.name = "Name is too long.";
  else if (/[\p{C}<>]/u.test(name)) errors.name = "Name contains characters that are not allowed.";

  if (!values.email.trim()) errors.email = "Enter your email address.";
  else if (!emailSchema.safeParse(values.email).success) errors.email = "Enter a valid email address.";

  if (!values.password) errors.password = "Create a password.";
  else {
    const issues = passwordPolicyIssues(values.password, values.email.trim().toLowerCase());
    if (issues.length > 0) errors.password = issues[0];
  }

  if (!values.confirmPassword) errors.confirmPassword = "Confirm your password.";
  else if (values.confirmPassword !== values.password) errors.confirmPassword = "Passwords do not match.";
  return errors;
}

const REDIRECT_DELAY_MS = 1500;

export const RegisterPage: React.FC = () => {
  const { register, user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState<Record<Field, string>>({ name: "", email: "", password: "", confirmPassword: "" });
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [created, setCreated] = useState(false);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});

  const clientErrors = validate(values);
  const errorFor = (field: Field): string | undefined => (touched[field] ? clientErrors[field] : undefined) ?? serverErrors[field];

  useEffect(() => {
    if (!created) return;
    const timer = window.setTimeout(() => navigate("/dashboard", { replace: true }), REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [created, navigate]);

  const setField = (field: Field) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setServerErrors((current) => ({ ...current, [field]: undefined }));
    setDuplicate(false);
    setFormError(null);
  };
  const markTouched = (field: Field) => () => setTouched((current) => ({ ...current, [field]: true }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setDuplicate(false);
    setTouched({ name: true, email: true, password: true, confirmPassword: true });

    const errors = validate(values);
    const firstInvalid = fieldOrder.find((field) => errors[field]);
    if (firstInvalid) {
      refs.current[firstInvalid]?.focus();
      return;
    }

    try {
      setIsSubmitting(true);
      await register({ name: values.name.trim(), email: values.email.trim(), password: values.password, confirmPassword: values.confirmPassword });
      setCreated(true);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "CONFLICT") {
          setDuplicate(true);
          setFormError(err.message);
        } else if (err.code === "RATE_LIMITED") {
          setFormError("Too many sign-up attempts. Please wait a while and try again.");
        } else if (err.code === "VALIDATION_ERROR" && Array.isArray(err.details)) {
          const mapped: FieldErrors = {};
          for (const item of err.details as Array<{ path?: string; message?: string }>) {
            if (item.path && (fieldOrder as string[]).includes(item.path) && item.message) mapped[item.path as Field] ??= item.message;
          }
          setServerErrors(mapped);
          setFormError(Object.keys(mapped).length > 0 ? "Please correct the highlighted fields." : "Some details were not accepted. Please check them and try again.");
          const first = fieldOrder.find((field) => mapped[field]);
          if (first) refs.current[first]?.focus();
        } else {
          setFormError("We could not create your account. Please try again.");
        }
      } else {
        setFormError("We could not reach the server. Check your connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Signed-in visitors have nothing to register. Not while our own submit is finishing: register() sets the user a tick
  // before this page learns it succeeded, and redirecting then would skip the success screen.
  if (!authLoading && user && !created && !isSubmitting) {
    return <Navigate to={user.role === "ADMIN" ? "/admin/dashboard" : "/dashboard"} replace />;
  }

  const toggle = (shown: boolean, set: (value: boolean) => void, label: string) => (
    <button
      type="button"
      onClick={() => set(!shown)}
      aria-label={`${shown ? "Hide" : "Show"} ${label}`}
      aria-pressed={shown}
      className="p-1 -mr-1 rounded text-stone-500 hover:text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {shown ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
    </button>
  );

  const rules: Array<{ label: string; met: boolean }> = [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: values.password.length >= PASSWORD_MIN_LENGTH },
    { label: "A lowercase letter", met: /[a-z]/.test(values.password) },
    { label: "An uppercase letter", met: /[A-Z]/.test(values.password) },
    { label: "A number", met: /[0-9]/.test(values.password) }
  ];

  return (
    <div className="min-h-screen bg-stone-100/70 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-800 text-emerald-300 shadow-md mb-4 border border-brand-700">
          <Feather className="w-6 h-6 text-emerald-300" aria-hidden="true" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 font-editorial">Create your author account</h1>
        <p className="mt-2 text-sm text-stone-600">Register to contact BookLeaf support and follow your requests in one place.</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-5 shadow-card border border-stone-200/80 rounded-2xl sm:px-10">
          {created ? (
            <div role="status" aria-live="polite" className="text-center py-4">
              <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-600" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-semibold text-stone-900">Account created</h2>
              <p className="mt-1 text-sm text-stone-600">Welcome to BookLeaf. Taking you to your dashboard…</p>
              <Button className="mt-5 w-full" onClick={() => navigate("/dashboard", { replace: true })}>
                Go to dashboard
              </Button>
            </div>
          ) : (
            <>
              <div aria-live="assertive">
                {formError && (
                  <Alert variant="error" className="mb-5">
                    {formError}
                    {duplicate && (
                      <>
                        {" "}
                        <Link to="/login" className="font-semibold underline">
                          Go to Sign In
                        </Link>
                      </>
                    )}
                  </Alert>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate aria-label="Create account">
                <Input
                  id="register-name"
                  ref={(el) => { refs.current.name = el; }}
                  label="Full name"
                  value={values.name}
                  onChange={setField("name")}
                  onBlur={markTouched("name")}
                  error={errorFor("name")}
                  leftIcon={<UserIcon className="w-4 h-4" />}
                  placeholder="Your full name"
                  autoComplete="name"
                  maxLength={100}
                  required
                />
                <Input
                  id="register-email"
                  ref={(el) => { refs.current.email = el; }}
                  type="email"
                  label="Email address"
                  value={values.email}
                  onChange={setField("email")}
                  onBlur={markTouched("email")}
                  error={errorFor("email")}
                  leftIcon={<Mail className="w-4 h-4" />}
                  placeholder="you@example.com"
                  autoComplete="email"
                  inputMode="email"
                  maxLength={254}
                  required
                />
                <div>
                  <Input
                    id="register-password"
                    ref={(el) => { refs.current.password = el; }}
                    type={showPassword ? "text" : "password"}
                    label="Password"
                    value={values.password}
                    onChange={setField("password")}
                    onBlur={markTouched("password")}
                    error={errorFor("password")}
                    leftIcon={<Lock className="w-4 h-4" />}
                    rightIcon={toggle(showPassword, setShowPassword, "password")}
                    autoComplete="new-password"
                    maxLength={128}
                    required
                  />
                  <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1" aria-label="Password requirements">
                    {rules.map((rule) => (
                      <li key={rule.label} className={`flex items-center gap-1.5 text-xs ${rule.met ? "text-emerald-700" : "text-stone-500"}`}>
                        {rule.met ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <X className="w-3.5 h-3.5" aria-hidden="true" />}
                        <span>
                          {rule.label}
                          <span className="sr-only">{rule.met ? " (met)" : " (not met yet)"}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Input
                  id="register-confirm"
                  ref={(el) => { refs.current.confirmPassword = el; }}
                  type={showConfirm ? "text" : "password"}
                  label="Confirm password"
                  value={values.confirmPassword}
                  onChange={setField("confirmPassword")}
                  onBlur={markTouched("confirmPassword")}
                  error={errorFor("confirmPassword")}
                  leftIcon={<Lock className="w-4 h-4" />}
                  rightIcon={toggle(showConfirm, setShowConfirm, "password confirmation")}
                  autoComplete="new-password"
                  maxLength={128}
                  required
                />

                <Button type="submit" variant="primary" size="lg" isLoading={isSubmitting} className="w-full font-semibold shadow-sm" rightIcon={<ArrowRight className="w-4 h-4" />}>
                  Create account
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-stone-600">
                Already have an account?{" "}
                <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-800 underline-offset-2 hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
