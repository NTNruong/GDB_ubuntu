import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileExtension, type Language, type ProjectFile } from "@internal/shared";

type FileTabsProps = {
  files: ProjectFile[];
  activePath: string;
  language: Language;
  onSelect(path: string): void;
  onAdd(): void;
  onRename(path: string, nextPath: string): void;
  onClose(path: string): void;
  onCloseOthers(path: string): void;
  onDelete(path: string): void;
};

type MenuState = { path: string; x: number; y: number } | null;

function iconColorVar(path: string): string {
  switch (fileExtension(path)) {
    case ".c":
      return "var(--icon-c)";
    case ".h":
      return "var(--icon-h)";
    case ".cpp":
    case ".cc":
      return "var(--icon-cpp)";
    case ".hpp":
    case ".hh":
      return "var(--icon-hpp)";
    default:
      return "var(--text-muted)";
  }
}

function iconLetter(path: string): string {
  switch (fileExtension(path)) {
    case ".h":
    case ".hh":
      return "H";
    case ".hpp":
      return "H+";
    case ".cpp":
    case ".cc":
      return "C+";
    default:
      return "C";
  }
}

// Spec-aligned file icon (DESIGN §7): a 14×14 rounded-rect "file card" with the
// extension letter centered inside, color-coded per extension. Replaces the old
// bare text letter, which read as part of the filename rather than an icon.
function FileIcon({ path }: { path: string }) {
  const color = iconColorVar(path);
  const letter = iconLetter(path);
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x={2} y={1} width={12} height={14} rx={1.5} stroke={color} strokeWidth={1.2} />
      <text
        x={8}
        y={11}
        fontSize={letter.length > 1 ? 6 : 7}
        fontWeight={700}
        fill={color}
        textAnchor="middle"
        fontFamily="system-ui"
      >
        {letter}
      </text>
    </svg>
  );
}

export function FileTabs({
  files,
  activePath,
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
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
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
            className={`editor-tab ${isActive ? "active" : ""}`}
            role="tab"
            aria-selected={isActive}
            data-path={file.path}
            onClick={() => onSelect(file.path)}
            onDoubleClick={() => beginRename(file.path)}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelect(file.path);
              setMenu({ path: file.path, x: event.clientX, y: event.clientY });
            }}
            title={file.path}
          >
            <span className="tab-icon" aria-hidden="true">
              <FileIcon path={file.path} />
            </span>
            <span className="tab-label">{file.path}</span>
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
          <li role="menuitem" onClick={() => beginRename(menu.path)}>
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
            aria-disabled={files.length <= 1}
            onClick={() => {
              if (files.length > 1) {
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
