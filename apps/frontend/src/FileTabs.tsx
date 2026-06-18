import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Language, type ProjectFile } from "@internal/shared";
import { FileTypeIcon } from "./fileTypeIcons";

/** Per-tab presentation overrides for server-backed (explorer) files. */
export type TabMeta = {
  /** Display label (basename) when the tab id is a full relative path. */
  label?: string;
  /** Unsaved-changes indicator. */
  dirty?: boolean;
  /** Server file — disable in-tab rename/delete (do it from the explorer). */
  locked?: boolean;
  /** Local scratch buffer (logged-in only) — not a /home/<user> file. */
  scratch?: boolean;
};

type FileTabsProps = {
  files: ProjectFile[];
  activePath: string;
  language: Language;
  meta?: Record<string, TabMeta>;
  onSelect(path: string): void;
  onAdd(): void;
  onRename(path: string, nextPath: string): void;
  onClose(path: string): void;
  onCloseOthers(path: string): void;
  onDelete(path: string): void;
};

type MenuState = { path: string; x: number; y: number } | null;

export function FileTabs({
  files,
  activePath,
  language,
  meta,
  onSelect,
  onAdd,
  onRename,
  onClose,
  onCloseOthers,
  onDelete
}: FileTabsProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<MenuState>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = () => setMenu(null);
    // Defer so the opening right-click/click doesn't bubble to window and close
    // the menu it just opened (open-then-close race).
    const id = window.setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  const beginRename = (path: string) => {
    setMenu(null);
    setDraft(path);
    setRenaming(path);
  };

  const commitRename = () => {
    if (renaming) {
      const next = draft.trim();
      if (next && next !== renaming) {
        onRename(renaming, next);
      }
    }
    setRenaming(null);
  };

  return (
    <div className="editor-tab-bar" role="tablist" aria-label="Open files">
      {files.map((file) => {
        const isActive = file.path === activePath;
        const tabMeta = meta?.[file.path];
        const label = tabMeta?.label ?? file.path;
        const locked = tabMeta?.locked ?? false;
        if (renaming === file.path) {
          return (
            <input
              key={file.path}
              ref={inputRef}
              className="tab-rename-input"
              value={draft}
              aria-label="Rename file"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitRename();
                } else if (event.key === "Escape") {
                  setRenaming(null);
                }
              }}
            />
          );
        }
        return (
          <div
            key={file.path}
            className={`editor-tab ${isActive ? "active" : ""}${tabMeta?.dirty ? " dirty" : ""}`}
            role="tab"
            aria-selected={isActive}
            data-path={file.path}
            onClick={() => onSelect(file.path)}
            onDoubleClick={() => {
              if (!locked) {
                beginRename(file.path);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(file.path);
              setMenu({ path: file.path, x: event.clientX, y: event.clientY });
            }}
            title={file.path}
          >
            <span className="tab-icon" aria-hidden="true">
              <FileTypeIcon name={label} language={language} />
            </span>
            <span className="tab-label">{label}</span>
            {tabMeta?.scratch && (
              <span className="tab-scratch-badge" title="Local scratch buffer — not saved in your files">
                Scratch
              </span>
            )}
            {tabMeta?.dirty && <span className="tab-dirty" aria-hidden="true" title="Unsaved changes" />}
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${file.path}`}
              disabled={files.length <= 1}
              onClick={(event) => {
                event.stopPropagation();
                onClose(file.path);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      <button type="button" className="tab-add" aria-label="Add file" title="Add file" onClick={onAdd}>
        <Plus size={14} />
      </button>

      {menu && (
        <ul
          className="tab-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <li
            role="menuitem"
            aria-disabled={meta?.[menu.path]?.locked ?? false}
            onClick={() => {
              if (!meta?.[menu.path]?.locked) {
                beginRename(menu.path);
              }
            }}
          >
            Rename
          </li>
          <li
            role="menuitem"
            aria-disabled={files.length <= 1}
            onClick={() => {
              if (files.length > 1) {
                onClose(menu.path);
              }
              setMenu(null);
            }}
          >
            Close
          </li>
          <li
            role="menuitem"
            aria-disabled={files.length <= 1}
            onClick={() => {
              if (files.length > 1) {
                onCloseOthers(menu.path);
              }
              setMenu(null);
            }}
          >
            Close Others
          </li>
          <li className="menu-separator" role="separator" />
          <li
            role="menuitem"
            className="menu-danger"
            aria-disabled={files.length <= 1 || (meta?.[menu.path]?.locked ?? false)}
            onClick={() => {
              if (files.length > 1 && !meta?.[menu.path]?.locked) {
                onDelete(menu.path);
              }
              setMenu(null);
            }}
          >
            Delete File
          </li>
        </ul>
      )}
    </div>
  );
}
