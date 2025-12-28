const ACCESS_TOKEN_KEY = "crewagent.accessToken";
const ACCESS_TOKEN_EVENT = "crewagent:auth-token-changed";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function notifyAccessTokenChanged(): void {
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(new Event(ACCESS_TOKEN_EVENT));
  } catch {
    // ignore
  }
}

export function setAccessToken(token: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
    notifyAccessTokenChanged();
  } catch {
    // ignore
  }
}

export function getAccessToken(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearAccessToken(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    notifyAccessTokenChanged();
  } catch {
    // ignore
  }
}
