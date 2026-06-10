import {
  ChevronRight,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { USER_PATH_SEGMENT_PATTERN, type TreeNode } from "@internal/shared";

type ExplorerProps = {
  username: string;
  entries: TreeNode[];
  activePath: string | null;
  onOpenFile(path: string): void;
  onRefresh(): void;
  onCreate(parentDir: string, name: string, kind: "file" | "folder"): void;
  onRename(path: string, newName: string): void;
  onDelete(node: TreeNode): void;
};

type Menu = { node: TreeNode | null; x: number; y: number } | null;
type Editing =
  | { kind: "rename"; path: string }
  | { kind: "create-file"; parent: string }
  | { kind: "create-folder"; parent: string }
  | null;

/** VSCode-like left sidebar file tree for the logged-in user's home. */
export function Explorer({
  username,
  entries,
  activePath,
  onOpenFile,
  onRefresh,
  onCreate,
  onRename,
  onDelete
}: ExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<Menu>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

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

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const startCreate = (parent: string, kind: "file" | "folder") => {
    setMenu(null);
    if (parent) {
      setExpanded((current) => new Set(current).add(parent));
    }
    setDraft("");
    setEditing({ kind: kind === "file" ? "create-file" : "create-folder", parent });
  };

  const startRename = (node: TreeNode) => {
    setMenu(null);
    setDraft(node.name);
    setEditing({ kind: "rename", path: node.path });
  };

  const commitEdit = () => {
    const name = draft.trim();
    if (!editing || !name || !USER_PATH_SEGMENT_PATTERN.test(name)) {
      setEditing(null);
      return;
    }
    if (editing.kind === "rename") {
      onRename(editing.path, name);
    } else {
      onCreate(editing.parent, name, editing.kind === "create-file" ? "file" : "folder");
    }
    setEditing(null);
  };

  const editorRow = (key: string) => (
    <div className="explorer-row" key={key}>
      <input
        ref={inputRef}
        className="explorer-input"
        aria-label="Entry name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitEdit();
          } else if (e.key === "Escape") {
            setEditing(null);
          }
        }}
      />
    </div>
  );

  const renderNodes = (nodes: TreeNode[], depth: number): ReactElement[] => {
    const rows: ReactElement[] = [];
    for (const node of nodes) {
      if (editing?.kind === "rename" && editing.path === node.path) {
        rows.push(editorRow(node.path));
        continue;
      }
      const isDir = node.type === "dir";
      const isOpen = expanded.has(node.path);
      rows.push(
        <div
          key={node.path}
          className={`explorer-row ${node.path === activePath ? "active" : ""}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          role="treeitem"
          aria-expanded={isDir ? isOpen : undefined}
          onClick={() => (isDir ? toggle(node.path) : onOpenFile(node.path))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ node, x: e.clientX, y: e.clientY });
          }}
          title={node.path}
        >
          <span className={`explorer-caret ${isDir && isOpen ? "open" : ""}`}>
            {isDir ? <ChevronRight size={14} /> : <span className="explorer-caret-spacer" />}
          </span>
          <span className="explorer-name">{node.name}</span>
        </div>
      );
      if (isDir && isOpen) {
        if ((editing?.kind === "create-file" || editing?.kind === "create-folder") && editing.parent === node.path) {
          rows.push(editorRow(`${node.path}::new`));
        }
        rows.push(...renderNodes(node.children ?? [], depth + 1));
      }
    }
    return rows;
  };

  const rootCreating = editing?.kind === "create-file" || editing?.kind === "create-folder";
  const rootRows = useMemo(() => renderNodes(entries, 0), [entries, expanded, editing, draft, activePath]);

  return (
    <aside className="explorer" aria-label="File explorer">
      <div className="explorer-header">
        <span className="explorer-title" title={`/home/${username}`}>
          /home/{username}
        </span>
        <div className="explorer-actions">
          <button type="button" aria-label="New file" title="New file" onClick={() => startCreate("", "file")}>
            <FilePlus size={14} />
          </button>
          <button type="button" aria-label="New folder" title="New folder" onClick={() => startCreate("", "folder")}>
            <FolderPlus size={14} />
          </button>
          <button type="button" aria-label="Refresh files" title="Refresh" onClick={onRefresh}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="explorer-tree" role="tree">
        {rootCreating && editing.parent === "" && editorRow("root::new")}
        {entries.length === 0 && !rootCreating ? (
          <p className="explorer-empty">No files yet — use the buttons above to create one.</p>
        ) : (
          rootRows
        )}
      </div>

      {menu && (
        <ul className="tab-context-menu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
          {menu.node?.type === "dir" && (
            <>
              <li role="menuitem" onClick={() => startCreate(menu.node!.path, "file")}>
                New File
              </li>
              <li role="menuitem" onClick={() => startCreate(menu.node!.path, "folder")}>
                New Folder
              </li>
              <li className="menu-separator" role="separator" />
            </>
          )}
          {menu.node && (
            <>
              <li role="menuitem" onClick={() => startRename(menu.node!)}>
                Rename
              </li>
              <li
                role="menuitem"
                className="menu-danger"
                onClick={() => {
                  onDelete(menu.node!);
                  setMenu(null);
                }}
              >
                <Trash2 size={13} /> Delete
              </li>
            </>
          )}
        </ul>
      )}
    </aside>
  );
}
