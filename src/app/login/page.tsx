"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useState } from "react";

import { getApiBaseUrl, postJson } from "@/lib/api-client";
import { getAccessToken, setAccessToken } from "@/lib/auth";

type Tab = "login" | "register";
type LoginField = "email" | "password";
type LoginErrors = Partial<Record<LoginField, string>>;
type RegisterField = "email" | "username" | "password";
type RegisterErrors = Partial<Record<RegisterField, string>>;

function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "Email 为必填";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Email 格式不正确";
  return null;
}

function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (!trimmed) return "Username 为必填";
  if (trimmed.length < 3 || trimmed.length > 32) return "Username 需为 3-32 个字符";
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return "Username 仅允许字母、数字、_、-";
  return null;
}

function validatePassword(password: string): string | null {
  if (!password) return "Password 为必填";
  if (password.length < 8) return "Password 至少 8 位";
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
          const details = result.error.details;
          setLoginErrors((prev) => ({
            ...prev,
            email: details.email ?? prev.email,
            password: details.password ?? prev.password,
          }));
        }

        setLoginSubmitError(result.error.message);
        return;
      }

      if (!result.data?.accessToken) {
        setLoginSubmitError("服务返回异常，请稍后再试");
        return;
      }

      setAccessToken(result.data.accessToken);
      router.replace("/dashboard");
    } catch {
      setLoginSubmitError("操作失败，请稍后再试");
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
          const details = result.error.details;
          setRegisterErrors((prev) => ({
            ...prev,
            email: details.email ?? prev.email,
            username: details.username ?? prev.username,
            password: details.password ?? prev.password,
          }));
        }
        setRegisterSubmitError(result.error.message);
        return;
      }

      if (!result.data?.accessToken) {
        setRegisterSubmitError("服务返回异常，请稍后再试");
        return;
      }

      setAccessToken(result.data.accessToken);
      router.replace("/dashboard");
    } catch {
      setRegisterSubmitError("操作失败，请稍后再试");
    } finally {
      setIsRegisterSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-12">
        <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h1 className="text-xl font-semibold tracking-tight">CrewAgent Builder</h1>
            <span className="text-xs text-zinc-500">Epic 2 · Auth</span>
          </div>
          <p className="mt-1 text-sm text-zinc-600">登录/注册以继续</p>

          {apiEnvError ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {apiEnvError}
            </div>
          ) : null}

          <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setActiveTab("login")}
              className={[
                "rounded-lg px-3 py-2 transition-colors",
                activeTab === "login"
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-600 hover:text-zinc-950",
              ].join(" ")}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("register")}
              className={[
                "rounded-lg px-3 py-2 transition-colors",
                activeTab === "register"
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-600 hover:text-zinc-950",
              ].join(" ")}
            >
              注册
            </button>
          </div>

          {activeTab === "login" ? (
            <form className="mt-6 space-y-4" onSubmit={onLoginSubmit}>
              {loginSubmitError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                >
                  {loginSubmitError}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label htmlFor="login-email" className="text-sm font-medium">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={loginEmail}
                  onChange={(e) => {
                    setLoginEmail(e.target.value);
                    if (loginErrors.email) setLoginErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  className={[
                    "w-full rounded-lg border px-3 py-2 text-sm outline-none",
                    loginErrors.email
                      ? "border-red-300 focus:border-red-400"
                      : "border-zinc-200 focus:border-zinc-400",
                  ].join(" ")}
                />
                {loginErrors.email ? <p className="text-xs text-red-600">{loginErrors.email}</p> : null}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="login-password" className="text-sm font-medium">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    if (loginErrors.password)
                      setLoginErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  className={[
                    "w-full rounded-lg border px-3 py-2 text-sm outline-none",
                    loginErrors.password
                      ? "border-red-300 focus:border-red-400"
                      : "border-zinc-200 focus:border-zinc-400",
                  ].join(" ")}
                />
                {loginErrors.password ? (
                  <p className="text-xs text-red-600">{loginErrors.password}</p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={isLoginSubmitting || Boolean(apiEnvError)}
                className="inline-flex w-full items-center justify-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoginSubmitting ? "登录中..." : "登录"}
              </button>

              <p className="text-center text-xs text-zinc-500">
                还没有账号？{" "}
                <button
                  type="button"
                  onClick={() => setActiveTab("register")}
                  className="font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-700"
                >
                  去注册
                </button>
              </p>
            </form>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={onRegisterSubmit}>
              {registerSubmitError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                >
                  {registerSubmitError}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label htmlFor="register-email" className="text-sm font-medium">
                  Email
                </label>
                <input
                  id="register-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={registerEmail}
                  onChange={(e) => {
                    setRegisterEmail(e.target.value);
                    if (registerErrors.email) setRegisterErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  className={[
                    "w-full rounded-lg border px-3 py-2 text-sm outline-none",
                    registerErrors.email
                      ? "border-red-300 focus:border-red-400"
                      : "border-zinc-200 focus:border-zinc-400",
                  ].join(" ")}
                />
                {registerErrors.email ? (
                  <p className="text-xs text-red-600">{registerErrors.email}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="register-username" className="text-sm font-medium">
                  Username
                </label>
                <input
                  id="register-username"
                  type="text"
                  autoComplete="username"
                  value={registerUsername}
                  onChange={(e) => {
                    setRegisterUsername(e.target.value);
                    if (registerErrors.username)
                      setRegisterErrors((prev) => ({ ...prev, username: undefined }));
                  }}
                  className={[
                    "w-full rounded-lg border px-3 py-2 text-sm outline-none",
                    registerErrors.username
                      ? "border-red-300 focus:border-red-400"
                      : "border-zinc-200 focus:border-zinc-400",
                  ].join(" ")}
                />
                {registerErrors.username ? (
                  <p className="text-xs text-red-600">{registerErrors.username}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="register-password" className="text-sm font-medium">
                  Password
                </label>
                <input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  value={registerPassword}
                  onChange={(e) => {
                    setRegisterPassword(e.target.value);
                    if (registerErrors.password)
                      setRegisterErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  className={[
                    "w-full rounded-lg border px-3 py-2 text-sm outline-none",
                    registerErrors.password
                      ? "border-red-300 focus:border-red-400"
                      : "border-zinc-200 focus:border-zinc-400",
                  ].join(" ")}
                />
                {registerErrors.password ? (
                  <p className="text-xs text-red-600">{registerErrors.password}</p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={isRegisterSubmitting || Boolean(apiEnvError)}
                className="inline-flex w-full items-center justify-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRegisterSubmitting ? "注册中..." : "注册"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
