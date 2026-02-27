const ACCESS_TOKEN_KEY = "crewagent.accessToken";
const USER_KEY = "crewagent.user";
const ACCESS_TOKEN_EVENT = "crewagent:auth-token-changed";

export interface User {
  id: number;
  email: string;
  username: string;
}

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

export function setUser(user: User): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

export function getUser(): User | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function clearAccessToken(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    notifyAccessTokenChanged();
  } catch {
    // ignore
  }
}
