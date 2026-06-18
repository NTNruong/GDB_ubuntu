// Thin component layer over the pure resolver in fileIcons.ts: maps an icon
// basename to its bundled SVG URL (via Vite glob) and renders it as a decorative
// <img>. Material Icon Theme SVGs carry their own colors, so no CSS tinting.
import type { Language } from "@internal/shared";
import { resolveFileIconName, resolveFolderIconName } from "./fileIcons";

const fileUrls = import.meta.glob("./icons/material/files/*.svg", {
  eager: true,
  query: "?url",
  import: "default"
}) as Record<string, string>;
const folderUrls = import.meta.glob("./icons/material/folders/*.svg", {
  eager: true,
  query: "?url",
  import: "default"
}) as Record<string, string>;

/** basename (without `.svg`) -> bundled asset URL. */
function toUrlMap(urls: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [path, url] of Object.entries(urls)) {
    const base = path.split("/").pop()?.replace(/\.svg$/, "");
    if (base) {
      map.set(base, url);
    }
  }
  return map;
}

const FILE_URLS = toUrlMap(fileUrls);
const FOLDER_URLS = toUrlMap(folderUrls);

/** Colored file-type icon for a filename (or basename). */
export function FileTypeIcon({ name, language }: { name: string; language?: Language }) {
  const url = FILE_URLS.get(resolveFileIconName(name, language)) ?? FILE_URLS.get("file");
  return <img className="ftype-icon" src={url} alt="" aria-hidden="true" draggable={false} />;
}

/** Colored folder icon that reflects open/closed state. */
export function FolderTypeIcon({ name, open }: { name: string; open: boolean }) {
  const fallback = FOLDER_URLS.get(open ? "folder-open" : "folder");
  const url = FOLDER_URLS.get(resolveFolderIconName(name, open)) ?? fallback;
  return <img className="ftype-icon" src={url} alt="" aria-hidden="true" draggable={false} />;
}
