import { LogOut, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import type { AuthMeResponse, TotpSetupResponse } from "@internal/shared";
import { accountApi, authApi } from "./filesApi";

type AccountPanelProps = {
  me: AuthMeResponse;
  onUpdated(me: AuthMeResponse): void;
  onClose(): void;
  onLoggedOut(): void;
};

/** Self-service account settings: profile, password, 2FA, log out everywhere. */
export function AccountPanel({ me, onUpdated, onClose, onLoggedOut }: AccountPanelProps) {
  const [displayName, setDisplayName] = useState(me.displayName ?? "");
  const [email, setEmail] = useState(me.email ?? "");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const adminNeeds2fa = me.role === "admin" && !me.twoFactorEnabled;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await action();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const saveProfile = () =>
    run(async () => {
      onUpdated(await accountApi.updateProfile({ displayName: displayName.trim(), email: email.trim() }));
      setMsg("Profile saved.");
    });

  const changePassword = () =>
    run(async () => {
      await authApi.changePassword(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      setMsg("Password changed. Other sessions were signed out.");
    });

  const startTotp = () =>
    run(async () => {
      setSetup(await accountApi.totpSetup());
    });

  const enableTotp = () =>
    run(async () => {
      onUpdated(await accountApi.totpEnable(totp.trim()));
      setSetup(null);
      setTotp("");
      setMsg("Two-factor authentication enabled.");
    });

  const disableTotp = () =>
    run(async () => {
      onUpdated(await accountApi.totpDisable());
      setMsg("Two-factor authentication disabled.");
    });

  const cancelTotp = () => {
    setSetup(null);
    setTotp("");
    setErr(null);
  };

  const logoutEverywhere = () =>
    run(async () => {
      await accountApi.logoutAll();
      onLoggedOut();
    });

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card account-card"
        role="dialog"
        aria-label="Account settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
        <h2 className="account-title">
          Account — <span className="account-name">{me.username}</span>{" "}
          <span className={`role-chip role-${me.role}`}>{me.role}</span>
        </h2>

        {adminNeeds2fa && (
          <p className="modal-error">Admins must enable two-factor authentication.</p>
        )}
        {err && <p className="modal-error">{err}</p>}
        {msg && <p className="modal-notice">{msg}</p>}

        <section className="account-section">
          <h3>Profile</h3>
          <label htmlFor="acc-display">Display name</label>
          <input id="acc-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <label htmlFor="acc-email">Email</label>
          <input id="acc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="button" className="primary" disabled={busy} onClick={saveProfile}>
            Save profile
          </button>
        </section>

        <section className="account-section">
          <h3>Change password</h3>
          <label htmlFor="acc-oldpw">Current password</label>
          <input id="acc-oldpw" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          <label htmlFor="acc-newpw">New password</label>
          <input id="acc-newpw" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <button type="button" className="primary" disabled={busy || !oldPw || !newPw} onClick={changePassword}>
            Change password
          </button>
        </section>

        <section className="account-section totp-section">
          <h3>
            <ShieldCheck size={15} /> Two-factor authentication{" "}
            {me.twoFactorEnabled ? <span className="role-chip role-admin">on</span> : null}
          </h3>

          {/* Status + actions. While the setup overlay is open they sit underneath it. */}
          {me.twoFactorEnabled ? (
            <div className="totp-actions">
              <button type="button" disabled={busy} onClick={startTotp}>
                Change 2FA
              </button>
              {me.role === "admin" ? (
                <button type="button" disabled title="Admins must keep 2FA enabled">
                  Required for admins
                </button>
              ) : (
                <button type="button" className="danger-btn" disabled={busy} onClick={disableTotp}>
                  Disable 2FA
                </button>
              )}
            </div>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={startTotp}>
              Enable 2FA
            </button>
          )}

          {/* Enrollment overlay: scan the QR (or copy the secret), then verify a code. */}
          {setup && (
            <div className="totp-overlay-card" role="group" aria-label="Two-factor setup">
              <button type="button" className="modal-close" aria-label="Cancel" onClick={cancelTotp}>
                <X size={15} />
              </button>
              <h4>{me.twoFactorEnabled ? "Change 2FA" : "Set up 2FA"}</h4>
              <p className="account-hint">Scan this QR with your authenticator app, then enter the 6-digit code.</p>
              <div className="qr-container">
                <img
                  className="totp-qr"
                  alt="Two-factor QR code"
                  src={`data:image/svg+xml,${encodeURIComponent(setup.qrSvg)}`}
                />
              </div>
              <p className="account-hint">Can&apos;t scan? Add this secret manually:</p>
              <code className="totp-secret">{setup.secret}</code>
              <a className="totp-link" href={setup.otpauthUri}>
                Open in authenticator app
              </a>
              <input
                inputMode="numeric"
                placeholder="123456"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
              />
              <div className="totp-actions">
                <button type="button" className="primary" disabled={busy || !totp} onClick={enableTotp}>
                  Verify & enable
                </button>
                <button type="button" disabled={busy} onClick={cancelTotp}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="account-section">
          <button type="button" className="danger-btn" disabled={busy} onClick={logoutEverywhere}>
            <LogOut size={15} /> Log out everywhere
          </button>
        </section>
      </div>
    </div>
  );
}
