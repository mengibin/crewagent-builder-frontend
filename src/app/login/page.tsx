"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useState } from "react";

import { getApiBaseUrl, postJson } from "@/lib/api-client";
import { getAccessToken, setAccessToken, setUser } from "@/lib/auth";

type Tab = "login" | "register";
type LoginField = "email" | "password";
type LoginErrors = Partial<Record<LoginField, string>>;
type RegisterField = "email" | "username" | "password";
type RegisterErrors = Partial<Record<RegisterField, string>>;

function parseValidationFieldErrors<T extends string>(
  details: unknown,
  fields: readonly T[],
): Partial<Record<T, string>> | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const obj = details as Record<string, unknown>;
  const out: Partial<Record<T, string>> = {};
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === "string" && value.trim()) out[field] = value;
  }
  return out;
}

function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Invalid email format.";
  return null;
}

function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (!trimmed) return "Username is required.";
  if (trimmed.length < 3 || trimmed.length > 32) return "Username must be 3–32 characters.";
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return "Username may contain only letters, numbers, _ and -.";
  return null;
}

function validatePassword(password: string): string | null {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

type RegisterResponseData = {
  accessToken: string;
  user: { id: number; email: string; username: string };
};

export default function LoginPage() {
  const router = useRouter();
  const { error: apiEnvError } = getApiBaseUrl();

  const [activeTab, setActiveTab] = useState<Tab>("login");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginErrors, setLoginErrors] = useState<LoginErrors>({});
  const [loginSubmitError, setLoginSubmitError] = useState<string | null>(null);
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);

  const [registerEmail, setRegisterEmail] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerErrors, setRegisterErrors] = useState<RegisterErrors>({});
  const [registerSubmitError, setRegisterSubmitError] = useState<string | null>(null);
  const [isRegisterSubmitting, setIsRegisterSubmitting] = useState(false);

  const isLogin = activeTab === "login";
  const heroTitle = isLogin ? "Log in to CrewAgent Builder" : "Create your CrewAgent account";
  const heroSub = isLogin
    ? "Continue building intelligent workflows, agents, and skills from one calm workspace."
    : "Start building intelligent workflows, agents, and skills with one calm workspace.";
  const panelNote = isLogin
    ? "New here? Create an account in seconds."
    : "Already have an account? Log in instead.";
  const panelLinkLabel = isLogin ? "Create your account →" : "Log in →";

  useEffect(() => {
    if (getAccessToken()) {
      router.replace("/dashboard");
    }
  }, [router]);

  async function onLoginSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoginSubmitError(null);

    const nextErrors: LoginErrors = {};
    const emailError = validateEmail(loginEmail);
    const passwordError = validatePassword(loginPassword);

    if (emailError) nextErrors.email = emailError;
    if (passwordError) nextErrors.password = passwordError;

    setLoginErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (apiEnvError) {
      setLoginSubmitError(apiEnvError);
      return;
    }

    setIsLoginSubmitting(true);
    try {
      const result = await postJson<RegisterResponseData>("/auth/login", {
        email: loginEmail.trim(),
        password: loginPassword,
      });

      if (result.error) {
        if (result.error.code === "VALIDATION_ERROR" && result.error.details) {
          const errors = parseValidationFieldErrors(result.error.details, ["email", "password"] as const);
          if (errors) setLoginErrors((prev) => ({ ...prev, ...errors }));
        }

        setLoginSubmitError(result.error.message);
        return;
      }

      if (!result.data?.accessToken) {
        setLoginSubmitError("Unexpected server response. Please try again later.");
        return;
      }

      setAccessToken(result.data.accessToken);
      setUser(result.data.user);
      router.replace("/dashboard");
    } catch {
      setLoginSubmitError("Request failed. Please try again.");
    } finally {
      setIsLoginSubmitting(false);
    }
  }

  async function onRegisterSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegisterSubmitError(null);

    const nextErrors: RegisterErrors = {};
    const emailError = validateEmail(registerEmail);
    const usernameError = validateUsername(registerUsername);
    const passwordError = validatePassword(registerPassword);

    if (emailError) nextErrors.email = emailError;
    if (usernameError) nextErrors.username = usernameError;
    if (passwordError) nextErrors.password = passwordError;

    setRegisterErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (apiEnvError) {
      setRegisterSubmitError(apiEnvError);
      return;
    }

    setIsRegisterSubmitting(true);
    try {
      const result = await postJson<RegisterResponseData>("/auth/register", {
        email: registerEmail.trim(),
        username: registerUsername.trim(),
        password: registerPassword,
      });

      if (result.error) {
        if (result.error.code === "VALIDATION_ERROR" && result.error.details) {
          const errors = parseValidationFieldErrors(result.error.details, ["email", "username", "password"] as const);
          if (errors) setRegisterErrors((prev) => ({ ...prev, ...errors }));
        }
        setRegisterSubmitError(result.error.message);
        return;
      }

      if (!result.data?.accessToken) {
        setRegisterSubmitError("Unexpected server response. Please try again later.");
        return;
      }

      setAccessToken(result.data.accessToken);
      setUser(result.data.user);
      router.replace("/dashboard");
    } catch {
      setRegisterSubmitError("Request failed. Please try again.");
    } finally {
      setIsRegisterSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#EEF2F8] text-[#1F2937]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center gap-10 px-6 py-12 lg:flex-row lg:justify-between">
        <div className="order-2 flex w-full justify-center lg:order-1 lg:flex-1">
          <div className="relative h-[320px] w-[320px] sm:h-[420px] sm:w-[420px] lg:h-[520px] lg:w-[520px]">
            <Image
              src="/login-hero.png"
              alt="CrewAgent Builder hero"
              fill
              priority
              className="object-contain"
            />
          </div>
        </div>

        <div className="order-1 w-full max-w-[420px] lg:order-2">
          <div className="flex flex-col gap-5">
            <span className="inline-flex w-fit items-center rounded-full border border-[#C7D2FE] bg-[#E9EDFF] px-3 py-1 text-xs font-semibold text-[#4F46E5]">
              CrewAgent Builder
            </span>
            <h1 className="text-3xl font-semibold leading-tight text-[#1F2937]">{heroTitle}</h1>
            <p className="text-sm text-[#5F6B82]">{heroSub}</p>

            <div className="rounded-[24px] border border-[#DDE3EE] bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.10)]">
              {apiEnvError ? (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  {apiEnvError}
                </div>
              ) : null}

              {isLogin ? (
                <form className="space-y-4" onSubmit={onLoginSubmit}>
                  {loginSubmitError ? (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                    >
                      {loginSubmitError}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label htmlFor="login-email" className="text-sm font-semibold text-[#1F2937]">
                      Email
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="name@company.com"
                      value={loginEmail}
                      onChange={(e) => {
                        setLoginEmail(e.target.value);
                        if (loginErrors.email) setLoginErrors((prev) => ({ ...prev, email: undefined }));
                      }}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-sm text-[#1F2937] outline-none placeholder:text-[#94A0B8] shadow-[0_4px_20px_rgba(15,23,42,0.08)]",
                        loginErrors.email
                          ? "border-red-300 focus:border-red-400"
                          : "border-[#DDE3EE] focus:border-[#4F46E5]",
                      ].join(" ")}
                    />
                    {loginErrors.email ? <p className="text-xs text-red-600">{loginErrors.email}</p> : null}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="login-password" className="text-sm font-semibold text-[#1F2937]">
                      Password
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => {
                        setLoginPassword(e.target.value);
                        if (loginErrors.password)
                          setLoginErrors((prev) => ({ ...prev, password: undefined }));
                      }}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-sm text-[#1F2937] outline-none placeholder:text-[#94A0B8] shadow-[0_4px_20px_rgba(15,23,42,0.08)]",
                        loginErrors.password
                          ? "border-red-300 focus:border-red-400"
                          : "border-[#DDE3EE] focus:border-[#4F46E5]",
                      ].join(" ")}
                    />
                    {loginErrors.password ? (
                      <p className="text-xs text-red-600">{loginErrors.password}</p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="text-left text-xs font-medium text-[#4F46E5]"
                  >
                    Forgot password?
                  </button>

                  <button
                    type="submit"
                    disabled={isLoginSubmitting || Boolean(apiEnvError)}
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-[#4F46E5] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(79,70,229,0.25)] hover:bg-[#4338CA] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoginSubmitting ? "Logging in..." : "Log in"}
                  </button>

                  <p className="text-xs text-[#94A0B8]">We’ll never share your credentials with anyone.</p>
                </form>
              ) : (
                <form className="space-y-4" onSubmit={onRegisterSubmit}>
                  {registerSubmitError ? (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                    >
                      {registerSubmitError}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label htmlFor="register-email" className="text-sm font-semibold text-[#1F2937]">
                      Email
                    </label>
                    <input
                      id="register-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="name@company.com"
                      value={registerEmail}
                      onChange={(e) => {
                        setRegisterEmail(e.target.value);
                        if (registerErrors.email) setRegisterErrors((prev) => ({ ...prev, email: undefined }));
                      }}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-sm text-[#1F2937] outline-none placeholder:text-[#94A0B8] shadow-[0_4px_20px_rgba(15,23,42,0.08)]",
                        registerErrors.email
                          ? "border-red-300 focus:border-red-400"
                          : "border-[#DDE3EE] focus:border-[#4F46E5]",
                      ].join(" ")}
                    />
                    {registerErrors.email ? (
                      <p className="text-xs text-red-600">{registerErrors.email}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="register-username" className="text-sm font-semibold text-[#1F2937]">
                      Username
                    </label>
                    <input
                      id="register-username"
                      type="text"
                      autoComplete="username"
                      placeholder="your-name"
                      value={registerUsername}
                      onChange={(e) => {
                        setRegisterUsername(e.target.value);
                        if (registerErrors.username)
                          setRegisterErrors((prev) => ({ ...prev, username: undefined }));
                      }}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-sm text-[#1F2937] outline-none placeholder:text-[#94A0B8] shadow-[0_4px_20px_rgba(15,23,42,0.08)]",
                        registerErrors.username
                          ? "border-red-300 focus:border-red-400"
                          : "border-[#DDE3EE] focus:border-[#4F46E5]",
                      ].join(" ")}
                    />
                    {registerErrors.username ? (
                      <p className="text-xs text-red-600">{registerErrors.username}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="register-password" className="text-sm font-semibold text-[#1F2937]">
                      Password
                    </label>
                    <input
                      id="register-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="••••••••"
                      value={registerPassword}
                      onChange={(e) => {
                        setRegisterPassword(e.target.value);
                        if (registerErrors.password)
                          setRegisterErrors((prev) => ({ ...prev, password: undefined }));
                      }}
                      className={[
                        "w-full rounded-2xl border px-4 py-3 text-sm text-[#1F2937] outline-none placeholder:text-[#94A0B8] shadow-[0_4px_20px_rgba(15,23,42,0.08)]",
                        registerErrors.password
                          ? "border-red-300 focus:border-red-400"
                          : "border-[#DDE3EE] focus:border-[#4F46E5]",
                      ].join(" ")}
                    />
                    {registerErrors.password ? (
                      <p className="text-xs text-red-600">{registerErrors.password}</p>
                    ) : null}
                  </div>

                  <button
                    type="submit"
                    disabled={isRegisterSubmitting || Boolean(apiEnvError)}
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-[#4F46E5] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(79,70,229,0.25)] hover:bg-[#4338CA] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRegisterSubmitting ? "Signing up..." : "Create account"}
                  </button>
                  <p className="text-xs text-[#94A0B8]">We’ll never share your credentials with anyone.</p>
                </form>
              )}
            </div>

            <p className="text-sm text-[#5F6B82]">{panelNote}</p>
            <button
              type="button"
              onClick={() => setActiveTab(isLogin ? "register" : "login")}
              className="text-left text-sm font-semibold text-[#4F46E5]"
            >
              {panelLinkLabel}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
