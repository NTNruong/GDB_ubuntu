import { Terminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { authApi, LoginError } from "./filesApi";

type LoginDialogProps = {
  onClose(): void;
  /** Resolve on success; reject with a LoginError (which may set totpRequired). */
  onSubmit(username: string, password: string, totp?: string): Promise<void>;
};

type Mode = "signin" | "register";

/** Modal sign-in / sign-up dialog for app-managed accounts. */
export function LoginDialog({ onClose, onSubmit }: LoginDialogProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setNeedTotp(false);
    setTotp("");
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "register") {
        await authApi.register(username.trim(), password, displayName.trim() || undefined);
        setNotice("Account created — waiting for an administrator to approve it.");
        setMode("signin");
        setPassword("");
        setBusy(false);
        return;
      }
      await onSubmit(username.trim(), password, needTotp ? totp.trim() : undefined);
    } catch (err) {
      if (err instanceof LoginError && err.totpRequired) {
        setNeedTotp(true);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Failed");
      }
      setBusy(false);
    }
  };

  const isRegister = mode === "register";

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
          <h2>{isRegister ? "Create account" : "Welcome back"}</h2>
          <p className="login-sub">
            {isRegister
              ? "New accounts need administrator approval before first sign-in."
              : "Sign in to your workspace, files & Chat AI."}
          </p>
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
          {isRegister && (
            <>
              <label htmlFor="login-display">Display name (optional)</label>
              <input
                id="login-display"
                value={displayName}
                autoComplete="nickname"
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </>
          )}
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            autoComplete={isRegister ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
          />
          {needTotp && !isRegister && (
            <>
              <label htmlFor="login-totp">Authenticator code</label>
              <input
                id="login-totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
              />
            </>
          )}
          {error && <p className="modal-error">{error}</p>}
          {notice && <p className="modal-notice">{notice}</p>}
          <button
            type="submit"
            className="primary modal-submit"
            disabled={busy || !username || !password || (needTotp && !totp)}
          >
            {busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="login-switch">
          {isRegister ? (
            <>
              Already have an account?{" "}
              <button type="button" className="link-btn" onClick={() => switchMode("signin")}>
                Sign in
              </button>
            </>
          ) : (
            <>
              No account yet?{" "}
              <button type="button" className="link-btn" onClick={() => switchMode("register")}>
                Create one
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
