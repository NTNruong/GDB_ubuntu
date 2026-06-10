import type {
  AuthMeResponse,
  FileResponse,
  FolderFilesResponse,
  TreeResponse
} from "@internal/shared";

/** Thrown when the server reports the session is missing/expired (401). */
export class AuthExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "AuthExpiredError";
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
  async me(): Promise<string | null> {
    try {
      const data = await request<AuthMeResponse>("/api/auth/me");
      return data.username;
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        return null;
      }
      throw error;
    }
  },
  async login(username: string, password: string): Promise<string> {
    const data = await request<AuthMeResponse>("/api/auth/login", {
      method: "POST",
      ...jsonBody({ username, password })
    });
    return data.username;
  },
  async logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  }
};

export const filesApi = {
  tree(): Promise<TreeResponse> {
    return request<TreeResponse>("/api/files/tree");
  },
  read(path: string): Promise<FileResponse> {
    return request<FileResponse>(`/api/files/content?path=${encodeURIComponent(path)}`);
  },
  folder(path: string): Promise<FolderFilesResponse> {
    return request<FolderFilesResponse>(`/api/files/folder?path=${encodeURIComponent(path)}`);
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
