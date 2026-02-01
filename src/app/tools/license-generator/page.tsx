"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { clearAccessToken } from "@/lib/auth";
import { getApiBaseUrl, postJson } from "@/lib/api-client";
import { useRequireAuth } from "@/lib/use-require-auth";

type LicenseGenerateResponse = {
  licenseKey: string;
};

type ExpiryMode = "date" | "permanent";

function parseExpiryDate(value: string): number | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  return time;
}

export default function LicenseGeneratorPage() {
  const router = useRouter();
  const ready = useRequireAuth();
  const { error: apiEnvError } = getApiBaseUrl();

  const [machineId, setMachineId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("date");
  const [expiryDate, setExpiryDate] = useState("");

  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  if (!ready) {
    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <p className="text-sm text-zinc-600">Redirecting...</p>
        </div>
      </main>
    );
  }

  async function onGenerate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitError(null);
    setCopyStatus("idle");

    const trimmedMachineId = machineId.trim();
    if (!trimmedMachineId) {
      setFormError("Machine ID is required.");
      return;
    }

    let expiresAt = -1;
    if (expiryMode === "date") {
      const parsed = parseExpiryDate(expiryDate);
      if (!parsed) {
        setFormError("Please select a valid expiry date.");
        return;
      }
      expiresAt = parsed;
    }

    if (apiEnvError) {
      setSubmitError(apiEnvError);
      return;
    }

    setIsGenerating(true);
    try {
      const res = await postJson<LicenseGenerateResponse>(
        "/license/generate",
        {
          machineId: trimmedMachineId,
          customerName: customerName.trim() || undefined,
          expiresAt,
          type: "commercial",
        },
        { auth: true },
      );

      if (res.error) {
        setSubmitError(res.error.message);
        return;
      }

      if (!res.data?.licenseKey) {
        setSubmitError("Unexpected server response. Please try again later.");
        return;
      }

      setLicenseKey(res.data.licenseKey);
    } catch {
      setSubmitError("Request failed. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function onCopy() {
    if (!licenseKey) return;
    try {
      await navigator.clipboard.writeText(licenseKey);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  function onDownload() {
    if (!licenseKey) return;
    const blob = new Blob([licenseKey], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeMachineId = machineId.trim().replace(/[^a-zA-Z0-9-_]+/g, "_") || "license";
    link.download = `${safeMachineId}.lic`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">License Generator</h1>
            <p className="mt-2 text-sm text-zinc-600">Generate offline license keys for a specific Machine ID.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
            >
              Back to Dashboard
            </Link>
            <button
              type="button"
              onClick={() => {
                clearAccessToken();
                router.replace("/login");
              }}
              className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
            >
              Sign out
            </button>
          </div>
        </div>

        {apiEnvError ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {apiEnvError}
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[2fr,1fr]">
          <form onSubmit={onGenerate} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="space-y-5">
              <div>
                <label className="text-sm font-medium text-zinc-900" htmlFor="machineId">
                  Machine ID
                </label>
                <input
                  id="machineId"
                  type="text"
                  value={machineId}
                  onChange={(e) => setMachineId(e.target.value)}
                  placeholder="e.g. 1c2f3a4b5c6d7e8f"
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-950 focus:border-zinc-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-zinc-900" htmlFor="customerName">
                  Customer Name <span className="text-xs text-zinc-500">(optional)</span>
                </label>
                <input
                  id="customerName"
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer or company"
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-950 focus:border-zinc-400 focus:outline-none"
                />
              </div>

              <div>
                <p className="text-sm font-medium text-zinc-900">Expiry</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      type="radio"
                      name="expiryMode"
                      value="date"
                      checked={expiryMode === "date"}
                      onChange={() => setExpiryMode("date")}
                    />
                    Set date
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      type="radio"
                      name="expiryMode"
                      value="permanent"
                      checked={expiryMode === "permanent"}
                      onChange={() => setExpiryMode("permanent")}
                    />
                    Permanent
                  </label>
                </div>
                {expiryMode === "date" ? (
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="mt-3 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-950 focus:border-zinc-400 focus:outline-none"
                  />
                ) : null}
              </div>
            </div>

            {formError ? (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                {formError}
              </div>
            ) : null}

            {submitError ? (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                {submitError}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={isGenerating}
                className="inline-flex items-center justify-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {isGenerating ? "Generating..." : "Generate License"}
              </button>
              <span className="text-xs text-zinc-500">Signed offline. No SaaS dependency.</span>
            </div>
          </form>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-900">Output</h2>
            <p className="mt-2 text-xs text-zinc-500">Copy or download the signed license key.</p>
            <textarea
              readOnly
              value={licenseKey}
              placeholder="License key will appear here."
              className="mt-4 h-40 w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 focus:outline-none"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCopy}
                disabled={!licenseKey}
                className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
              >
                {copyStatus === "copied" ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={onDownload}
                disabled={!licenseKey}
                className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
              >
                Download .lic
              </button>
              {copyStatus === "error" ? (
                <span className="self-center text-xs text-red-600">Copy failed. Please copy manually.</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
