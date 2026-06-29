import type {
  AdminUsersResponse,
  AdminUserView,
  AuthMeResponse,
  FileResponse,
  FolderFilesResponse,
  RegisterResponse,
  TotpSetupResponse,
  TreeResponse,
  UserRole
} from "@internal/shared";

/** Thrown when the server reports the session is missing/expired (401). */
export class AuthExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "AuthExpiredError";
  }
}

/** Login failure carrying whether a TOTP second factor is now required. */
export class LoginError extends Error {
  totpRequired: boolean;
  constructor(message: string, totpRequired: boolean) {
    super(message);
    this.name = "LoginError";
    this.totpRequired = totpRequired;
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    return (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    return text || response.statusText;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, credentials: "same-origin" });
  if (response.status === 401) {
    throw new AuthExpiredError();
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

function jsonBody(body: unknown): RequestInit {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export const authApi = {
  async me(): Promise<AuthMeResponse | null> {
    try {
      return await request<AuthMeResponse>("/api/auth/me");
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        return null;
      }
      throw error;
    }
  },
  /**
   * Log in. Does its own fetch (not the shared `request`, which turns every 401
   * into AuthExpiredError) so a wrong password / "TOTP required" surfaces its real
   * message and the `totpRequired` flag.
   */
  async login(username: string, password: string, totp?: string): Promise<AuthMeResponse> {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      ...jsonBody({ username, password, ...(totp ? { totp } : {}) })
    });
    if (res.ok) {
      return (await res.json()) as AuthMeResponse;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; totpRequired?: boolean };
    throw new LoginError(body.error ?? "Sign in failed", body.totpRequired === true);
  },
  async register(username: string, password: string, displayName?: string): Promise<RegisterResponse> {
    return request<RegisterResponse>("/api/auth/register", {
      method: "POST",
      ...jsonBody({ username, password, ...(displayName ? { displayName } : {}) })
    });
  },
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await request<{ ok: true }>("/api/auth/change-password", {
      method: "POST",
      ...jsonBody({ oldPassword, newPassword })
    });
  },
  async logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  }
};

/** Self-service account routes (profile, 2FA, log-out-everywhere). */
export const accountApi = {
  updateProfile(patch: { displayName?: string; email?: string }): Promise<AuthMeResponse> {
    return request<AuthMeResponse>("/api/account/profile", { method: "PUT", ...jsonBody(patch) });
  },
  async logoutAll(): Promise<void> {
    await request<{ ok: true }>("/api/account/logout-all", { method: "POST" });
  },
  totpSetup(): Promise<TotpSetupResponse> {
    return request<TotpSetupResponse>("/api/account/2fa/setup", { method: "POST" });
  },
  totpEnable(totp: string): Promise<AuthMeResponse> {
    return request<AuthMeResponse>("/api/account/2fa/enable", { method: "POST", ...jsonBody({ totp }) });
  },
  totpDisable(): Promise<AuthMeResponse> {
    return request<AuthMeResponse>("/api/account/2fa/disable", { method: "POST" });
  }
};

/** Admin-only user management (mirrors the `users` CLI). All routes require role=admin. */
export const adminApi = {
  async list(): Promise<AdminUserView[]> {
    return (await request<AdminUsersResponse>("/api/admin/users")).users;
  },
  async approve(username: string): Promise<void> {
    await request(`/api/admin/users/${encodeURIComponent(username)}/approve`, { method: "POST" });
  },
  async reject(username: string): Promise<void> {
    await request(`/api/admin/users/${encodeURIComponent(username)}/reject`, { method: "POST" });
  },
  async setRole(username: string, role: UserRole): Promise<void> {
    await request(`/api/admin/users/${encodeURIComponent(username)}/role`, {
      method: "POST",
      ...jsonBody({ role })
    });
  },
  async setStatus(username: string, status: "active" | "disabled"): Promise<void> {
    await request(`/api/admin/users/${encodeURIComponent(username)}/status`, {
      method: "POST",
      ...jsonBody({ status })
    });
  },
  async resetPassword(username: string, newPassword: string): Promise<void> {
    await request(`/api/admin/users/${encodeURIComponent(username)}/reset-password`, {
      method: "POST",
      ...jsonBody({ newPassword })
    });
  },
  async remove(username: string): Promise<void> {
    await request(`/api/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });
  }
};

export const filesApi = {
  tree(): Promise<TreeResponse> {
    return request<TreeResponse>("/api/files/tree");
  },
  read(path: string): Promise<FileResponse> {
    return request<FileResponse>(`/api/files/content?path=${encodeURIComponent(path)}`);
  },
  folder(path: string, recursive = false): Promise<FolderFilesResponse> {
    const query = `path=${encodeURIComponent(path)}${recursive ? "&recursive=1" : ""}`;
    return request<FolderFilesResponse>(`/api/files/folder?${query}`);
  },
  write(path: string, content: string): Promise<FileResponse> {
    return request<FileResponse>("/api/files/content", { method: "PUT", ...jsonBody({ path, content }) });
  },
  mkdir(path: string): Promise<void> {
    return request<{ ok: true }>("/api/files/mkdir", { method: "POST", ...jsonBody({ path }) }).then(() => undefined);
  },
  rename(path: string, newName: string): Promise<string> {
    return request<{ ok: true; path: string }>("/api/files/rename", {
      method: "POST",
      ...jsonBody({ path, newName })
    }).then((r) => r.path);
  },
  remove(path: string): Promise<void> {
    return request<{ ok: true }>(`/api/files/entry?path=${encodeURIComponent(path)}`, {
      method: "DELETE"
    }).then(() => undefined);
  }
};
