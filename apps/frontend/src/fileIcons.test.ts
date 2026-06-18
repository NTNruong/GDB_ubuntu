import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FILE_ICON_NAMES,
  FOLDER_ICON_NAMES,
  resolveFileIconName,
  resolveFolderIconName
} from "./fileIcons";

const here = dirname(fileURLToPath(import.meta.url));
const FILE_NAME_SET = new Set<string>(FILE_ICON_NAMES);
const FOLDER_NAME_SET = new Set<string>(FOLDER_ICON_NAMES);

describe("resolveFileIconName", () => {
  it("maps language extensions", () => {
    expect(resolveFileIconName("main.c")).toBe("c");
    expect(resolveFileIconName("main.cpp")).toBe("cpp");
    expect(resolveFileIconName("app.py")).toBe("python");
    expect(resolveFileIconName("index.js")).toBe("javascript");
    expect(resolveFileIconName("Main.java")).toBe("java");
    expect(resolveFileIconName("main.go")).toBe("go");
    expect(resolveFileIconName("lib.rs")).toBe("rust");
  });

  it("maps common file types", () => {
    expect(resolveFileIconName("data.json")).toBe("json");
    expect(resolveFileIconName("conf.yaml")).toBe("yaml");
    expect(resolveFileIconName("notes.md")).toBe("markdown");
    expect(resolveFileIconName("logo.png")).toBe("image");
    expect(resolveFileIconName("page.html")).toBe("html");
    expect(resolveFileIconName("style.css")).toBe("css");
  });

  it("prefers exact filenames over extension", () => {
    expect(resolveFileIconName("package.json")).toBe("nodejs");
    expect(resolveFileIconName("tsconfig.json")).toBe("tsconfig");
    expect(resolveFileIconName("Dockerfile")).toBe("docker");
    expect(resolveFileIconName(".gitignore")).toBe("git");
    expect(resolveFileIconName("README.md")).toBe("readme");
    expect(resolveFileIconName("package-lock.json")).toBe("lock");
  });

  it("normalizes a full path to its basename", () => {
    expect(resolveFileIconName("src/sub/package.json")).toBe("nodejs");
    expect(resolveFileIconName("a\\b\\main.go")).toBe("go");
  });

  it("disambiguates the .h header by language", () => {
    expect(resolveFileIconName("queue.h")).toBe("c");
    expect(resolveFileIconName("queue.h", "cpp")).toBe("cpp");
    expect(resolveFileIconName("queue.h", "c")).toBe("c");
  });

  it("falls back to the generic file icon for unknown types", () => {
    expect(resolveFileIconName("mystery.xyz")).toBe("file");
    expect(resolveFileIconName("noext")).toBe("file");
  });

  it("only ever returns a vendored file icon name", () => {
    const samples = [
      "a.c",
      "a.h",
      "a.cpp",
      "a.py",
      "a.js",
      "a.unknownext",
      "package.json",
      "Dockerfile"
    ];
    for (const s of samples) {
      expect(FILE_NAME_SET.has(resolveFileIconName(s))).toBe(true);
    }
  });
});

describe("resolveFolderIconName", () => {
  it("maps special folders, closed and open", () => {
    expect(resolveFolderIconName("src", false)).toBe("folder-src");
    expect(resolveFolderIconName("src", true)).toBe("folder-src-open");
    expect(resolveFolderIconName("node_modules", true)).toBe("folder-node-open");
    expect(resolveFolderIconName(".vscode", false)).toBe("folder-vscode");
  });

  it("falls back to the generic folder icon", () => {
    expect(resolveFolderIconName("whatever", false)).toBe("folder");
    expect(resolveFolderIconName("whatever", true)).toBe("folder-open");
  });

  it("only ever returns a vendored folder icon name", () => {
    for (const name of ["src", "tests", "dist", "node_modules", "weird"]) {
      expect(FOLDER_NAME_SET.has(resolveFolderIconName(name, false))).toBe(true);
      expect(FOLDER_NAME_SET.has(resolveFolderIconName(name, true))).toBe(true);
    }
  });
});

describe("vendored SVG assets exist (guards upstream name drift)", () => {
  it("has a file SVG for every declared file icon name", () => {
    for (const name of FILE_ICON_NAMES) {
      expect(existsSync(join(here, "icons", "material", "files", `${name}.svg`))).toBe(true);
    }
  });

  it("has a folder SVG for every declared folder icon name", () => {
    for (const name of FOLDER_ICON_NAMES) {
      expect(existsSync(join(here, "icons", "material", "folders", `${name}.svg`))).toBe(true);
    }
  });
});
