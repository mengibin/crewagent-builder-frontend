"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { clearAccessToken } from "@/lib/auth";
import { deleteJson, getApiBaseUrl, getJson, postFormData, postJson } from "@/lib/api-client";
import { useRequireAuth } from "@/lib/use-require-auth";

type PackageListItem = {
  id: number;
  name: string;
};

type ImportResult = {
  project_id: number;
  project_name: string;
  workflows_count: number;
  agents_count: number;
};

type ValidationErrorDetail = {
  code: string;
  file: string;
  path: string;
  message: string;
};

type ImportNameConflictDetails = {
  conflicting_name?: string;
  suggested_name?: string;
};

function parseImportNameConflictDetails(details: unknown): ImportNameConflictDetails | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const obj = details as Record<string, unknown>;
  const conflicting_name = typeof obj.conflicting_name === "string" ? obj.conflicting_name : undefined;
  const suggested_name = typeof obj.suggested_name === "string" ? obj.suggested_name : undefined;
  return { conflicting_name, suggested_name };
}

export default function DashboardPage() {
  const router = useRouter();
  const ready = useRequireAuth();
  const { error: apiEnvError } = getApiBaseUrl();

  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create Project Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Import Package Modal State
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<ValidationErrorDetail[]>([]);
  const [importNameConflict, setImportNameConflict] = useState<ImportNameConflictDetails | null>(null);
  const [importCustomName, setImportCustomName] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete Project State
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);


  useEffect(() => {
    if (!ready) return;
    if (apiEnvError) return;

    setIsLoading(true);
    setLoadError(null);
    getJson<PackageListItem[]>("/packages", { auth: true })
      .then((res) => {
        if (res.error) {
          setLoadError(res.error.message);
          return;
        }
        setPackages(res.data ?? []);
      })
      .catch(() => setLoadError("Failed to load. Please try again later."))
      .finally(() => setIsLoading(false));
  }, [apiEnvError, ready]);

  if (!ready) {
    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-sm text-zinc-600">Redirecting...</p>
        </div>
      </main>
    );
  }

  async function onCreateProject() {
    setCreateError(null);

    const trimmed = projectName.trim();
    if (!trimmed) {
      setCreateError("Project name is required.");
      return;
    }
    if (trimmed.length > 200) {
      setCreateError("Project name must be at most 200 characters.");
      return;
    }
    if (apiEnvError) {
      setCreateError(apiEnvError);
      return;
    }

    setIsCreating(true);
    try {
      const res = await postJson<PackageListItem>("/packages", { name: trimmed }, { auth: true });
      if (res.error) {
        setCreateError(res.error.message);
        return;
      }
      if (!res.data?.id) {
        setCreateError("Unexpected server response. Please try again later.");
        return;
      }
      router.push(`/builder/${res.data.id}`);
    } catch {
      setCreateError("Failed to create. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }

  async function onImportPackage(customName?: string) {
    if (!importFile) return;
    if (apiEnvError) {
      setImportError(apiEnvError);
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportErrors([]);
    setImportNameConflict(null);
    setImportProgress("Uploading...");

    try {
      const formData = new FormData();
      formData.append("file", importFile);

      setImportProgress("Validating...");
      const trimmedName = customName?.trim();
      const url = trimmedName ? `/packages/import?custom_name=${encodeURIComponent(trimmedName)}` : "/packages/import";
      const res = await postFormData<ImportResult>(url, formData, { auth: true });

      if (res.error) {
        setImportError(res.error.message);

        if (res.error.code === "PKG_NAME_CONFLICT") {
          const conflict = parseImportNameConflictDetails(res.error.details);
          setImportNameConflict(conflict);
          setImportCustomName(conflict?.suggested_name ?? "");
          return;
        }

        const details = res.error.details as unknown as ValidationErrorDetail[] | null;
        if (Array.isArray(details)) setImportErrors(details);
        return;
      }

      if (!res.data?.project_id) {
        setImportError("Unexpected server response. Please try again later.");
        return;
      }

      // Success - navigate to the new project
      router.push(`/builder/${res.data.project_id}`);
    } catch {
      setImportError("Import failed. Please try again.");
    } finally {
      setIsImporting(false);
      setImportProgress("");
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith(".bmad")) {
        setImportError("Please select a .bmad file.");
        return;
      }
      setImportFile(file);
      setImportError(null);
      setImportErrors([]);
      setImportNameConflict(null);
      setImportCustomName("");
    }
  }

  function openImportModal() {
    setIsImportOpen(true);
    setImportFile(null);
    setImportError(null);
    setImportErrors([]);
    setImportNameConflict(null);
    setImportCustomName("");
    setImportProgress("");
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-2 text-sm text-zinc-600">Create and manage your projects.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openImportModal}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Import Package
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreateOpen(true);
                setProjectName("");
                setCreateError(null);
              }}
              className="inline-flex items-center justify-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              New Project
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

        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">My Projects</h2>
            <span className="text-xs text-zinc-500">{packages.length} projects</span>
          </div>

          {isLoading ? (
            <p className="mt-4 text-sm text-zinc-600">Loading...</p>
          ) : loadError ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              {loadError}
            </div>
          ) : packages.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-300 bg-white p-6">
              <p className="text-sm text-zinc-600">No projects yet. Click New Project to create one.</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
              {packages.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-950">{p.name}</p>
                    <p className="text-xs text-zinc-500">ID: {p.id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/builder/${p.id}`}
                      className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
                    >
                      Open
                    </Link>
                    {deleteConfirmId === p.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            setIsDeleting(true);
                            try {
                              const res = await deleteJson(`/packages/${p.id}`, { auth: true });
                              if (res.error) {
                                setLoadError(res.error.message);
                              } else {
                                setPackages((prev) => prev.filter((pkg) => pkg.id !== p.id));
                              }
                            } catch {
                              setLoadError("Delete failed.");
                            } finally {
                              setIsDeleting(false);
                              setDeleteConfirmId(null);
                            }
                          }}
                          disabled={isDeleting}
                          className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                        >
                          {isDeleting ? "Deleting..." : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="text-sm text-zinc-500 hover:text-zinc-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(p.id)}
                        className="text-sm text-zinc-500 hover:text-red-600"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700"
          >
            Back to Login
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

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div
            className="absolute inset-0 bg-zinc-950/30"
            onClick={() => {
              if (!isCreating) setIsCreateOpen(false);
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold tracking-tight">Create New Project</h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                disabled={isCreating}
                className="text-sm text-zinc-500 hover:text-zinc-700 disabled:opacity-60"
              >
                Close
              </button>
            </div>

            {createError ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                {createError}
              </div>
            ) : null}

            <div className="mt-4 space-y-1.5">
              <label htmlFor="project-name" className="text-sm font-medium">
                Project name
              </label>
              <input
                id="project-name"
                type="text"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  if (createError) setCreateError(null);
                }}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                placeholder="e.g. My Project"
                disabled={isCreating}
              />
              <p className="text-xs text-zinc-500">Used for display and export; you can rename it later.</p>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                disabled={isCreating}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onCreateProject}
                disabled={isCreating}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Import Package Modal */}
      {isImportOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div
            className="absolute inset-0 bg-zinc-950/30"
            onClick={() => {
              if (!isImporting) setIsImportOpen(false);
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold tracking-tight">Import .bmad Package</h3>
              <button
                type="button"
                onClick={() => setIsImportOpen(false)}
                disabled={isImporting}
                className="text-sm text-zinc-500 hover:text-zinc-700 disabled:opacity-60"
              >
                Close
              </button>
            </div>

            {importError ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                {importError}
              </div>
            ) : null}

            {importErrors.length > 0 ? (
              <div className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-900 mb-2">Validation errors ({importErrors.length})</p>
                <ul className="space-y-1">
                  {importErrors.map((err, i) => (
                    <li key={i} className="text-xs text-red-800">
                      <span className="font-medium">{err.file}</span>
                      {err.path ? <span className="text-red-600"> {err.path}</span> : null}
                      <span className="block text-red-700">{err.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {importNameConflict ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-semibold text-amber-900">Project name already exists</p>
                {importNameConflict.conflicting_name ? (
                  <p className="mt-1 text-xs text-amber-800">
                    Conflicting name: <span className="font-mono">{importNameConflict.conflicting_name}</span>
                  </p>
                ) : null}
                <div className="mt-3 space-y-1.5">
                  <label htmlFor="import-custom-name" className="text-xs font-medium text-amber-900">
                    New project name
                  </label>
                  <input
                    id="import-custom-name"
                    type="text"
                    value={importCustomName}
                    onChange={(e) => setImportCustomName(e.target.value)}
                    disabled={isImporting}
                    className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300 disabled:opacity-60"
                    placeholder={importNameConflict.suggested_name || "my-project-imported"}
                  />
                  <p className="text-[11px] text-amber-800">
                    Choose a new name and retry import (backend will validate uniqueness).
                  </p>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsImportOpen(false)}
                    disabled={isImporting}
                    className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void onImportPackage(importCustomName)}
                    disabled={isImporting || !importCustomName.trim()}
                    className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-60"
                  >
                    Retry import
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 transition-colors ${importFile
                  ? "border-green-300 bg-green-50"
                  : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100"
                  }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".bmad"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={isImporting}
                />
                {importFile ? (
                  <>
                    <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="mt-2 text-sm font-medium text-green-900">{importFile.name}</p>
                    <p className="text-xs text-green-700">{(importFile.size / 1024).toFixed(1)} KB</p>
                  </>
                ) : (
                  <>
                    <svg className="h-8 w-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="mt-2 text-sm text-zinc-600">Click or drag a .bmad file here</p>
                  </>
                )}
              </div>
            </div>

            {isImporting && importProgress ? (
              <div className="mt-4 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-200">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-zinc-900" />
                </div>
                <span className="text-xs text-zinc-500">{importProgress}</span>
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsImportOpen(false)}
                disabled={isImporting}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onImportPackage()}
                disabled={isImporting || !importFile || Boolean(importNameConflict)}
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {isImporting ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
