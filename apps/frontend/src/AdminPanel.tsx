import { Check, KeyRound, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AdminUserView } from "@internal/shared";
import { adminApi } from "./filesApi";

type AdminPanelProps = {
  currentUsername: string;
  onClose(): void;
};

/** In-app admin view: approve/reject sign-ups and manage existing users. */
export function AdminPanel({ currentUsername, onClose }: AdminPanelProps) {
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setUsers(await adminApi.list());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load users");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const pending = users.filter((u) => u.status === "pending");
  const active = users.filter((u) => u.status !== "pending");

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card admin-card"
        role="dialog"
        aria-label="User administration"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
        <h2 className="account-title">User administration</h2>
        {err && <p className="modal-error">{err}</p>}

        {pending.length > 0 && (
          <section className="account-section">
            <h3>Pending approval ({pending.length})</h3>
            {pending.map((u) => (
              <div key={u.username} className="admin-row">
                <span className="admin-user">
                  {u.username}
                  {u.displayName ? <em> — {u.displayName}</em> : null}
                </span>
                <div className="admin-actions">
                  <button type="button" className="primary" disabled={busy} onClick={() => act(() => adminApi.approve(u.username))}>
                    <Check size={14} /> Approve
                  </button>
                  <button type="button" disabled={busy} onClick={() => act(() => adminApi.reject(u.username))}>
                    <X size={14} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="account-section">
          <h3>Users ({active.length})</h3>
          {active.map((u) => {
            const self = u.username === currentUsername;
            return (
              <div key={u.username} className="admin-row">
                <span className="admin-user">
                  {u.username}
                  <span className={`role-chip role-${u.role}`}>{u.role}</span>
                  {u.status === "disabled" ? <span className="role-chip role-user">disabled</span> : null}
                  {u.twoFactorEnabled ? <span className="role-chip role-admin">2fa</span> : null}
                </span>
                <div className="admin-actions">
                  <button
                    type="button"
                    disabled={busy || self}
                    title="Toggle admin role"
                    onClick={() => act(() => adminApi.setRole(u.username, u.role === "admin" ? "user" : "admin"))}
                  >
                    {u.role === "admin" ? "Make user" : "Make admin"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || self}
                    onClick={() =>
                      act(() => adminApi.setStatus(u.username, u.status === "disabled" ? "active" : "disabled"))
                    }
                  >
                    {u.status === "disabled" ? "Enable" : "Disable"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title="Reset password"
                    onClick={() => {
                      const pw = window.prompt(`New password for "${u.username}":`);
                      if (pw) {
                        void act(() => adminApi.resetPassword(u.username, pw));
                      }
                    }}
                  >
                    <KeyRound size={14} />
                  </button>
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={busy || self}
                    title="Delete user"
                    onClick={() => {
                      if (window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) {
                        void act(() => adminApi.remove(u.username));
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
