import { Terminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type LoginDialogProps = {
  onClose(): void;
  onSubmit(username: string, password: string): Promise<void>;
};

/** Modal sign-in dialog for app-managed accounts (Phase 2). */
export function LoginDialog({ onClose, onSubmit }: LoginDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    userRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card login-card" role="dialog" aria-label="Sign in" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close login-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
        <div className="login-hero">
          <div className="login-brand">
            <Terminal size={22} />
          </div>
          <h2>Welcome back</h2>
          <p className="login-sub">Sign in to your workspace, files &amp; Chat AI.</p>
        </div>
        <form className="modal-body" onSubmit={submit}>
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            ref={userRef}
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="modal-error">{error}</p>}
          <button type="submit" className="primary modal-submit" disabled={busy || !username || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
