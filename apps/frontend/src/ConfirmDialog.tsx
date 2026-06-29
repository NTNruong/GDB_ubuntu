import { AlertTriangle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red/danger styling + icon for destructive actions (delete, clear). */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * Promise-based confirm modal that matches the app's dark/light theme (replaces
 * `window.confirm`). Usage: `const { confirm, dialog } = useConfirm();` then
 * `if (await confirm({ title, message })) { … }`, and render `{dialog}` once.
 */
export function useConfirm(): { confirm: (opts: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    []
  );

  const close = useCallback((ok: boolean) => {
    setPending((current) => {
      if (current) current.resolve(ok);
      return null;
    });
  }, []);

  const dialog = pending ? (
    <ConfirmDialog {...pending} onConfirm={() => close(true)} onCancel={() => close(false)} />
  ) : null;

  return { confirm, dialog };
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel
}: ConfirmOptions & { onConfirm(): void; onCancel(): void }) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal-card confirm-card" role="alertdialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {danger && <AlertTriangle size={16} />} {title}
          </h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body confirm-body">
          <p className="confirm-message">{message}</p>
          <div className="confirm-actions">
            <button type="button" className="confirm-cancel" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" ref={confirmRef} className={`primary${danger ? " danger" : ""}`} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
