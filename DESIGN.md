---
version: 1.1.0
name: Web-Debugger UI
description: A premium, dark-mode developer environment featuring glassmorphic overlays, vibrant emerald green accents, and a precise, developer-centric layout using Monaco and Inter.
---

# DESIGN.md — Web-Debugger Design System

This file defines the visual language, design tokens, styling rules, and layout components of the tailnet-only online code runner and debugger. All UI/UX design agents must follow these specifications strictly to maintain aesthetic integrity and consistency.

---

## Design Tokens

### 1. Colors

Our color system uses HSL and HEX values mapped to deep cool grays, vibrant primary accents, and rich semantic indicators.

```yaml
colors:
  # Layered backgrounds (Darkest → Lightest)
  bg-terminal: "hsl(215, 20%, 5%)"    # Deepest black-gray for code outputs
  bg-base: "hsl(215, 20%, 7%)"        # Main app-shell background
  bg-layer-1: "hsl(215, 20%, 9%)"     # Sidebar body background
  bg-layer-2: "hsl(215, 20%, 11%)"    # Topbar & tabbar inactive state
  bg-layer-3: "hsl(215, 20%, 13%)"    # Panel segment dividers
  bg-surface: "hsl(215, 20%, 15%)"    # Buttons, inputs, active cards
  bg-elevated: "hsl(215, 20%, 18%)"   # Tooltips, hover states, floating toolbar

  # Borders
  border-subtle: "hsl(215, 12%, 18%)" # Secondary gridlines
  border-default: "hsl(215, 14%, 24%)"# Primary boundaries
  border-focus: "hsl(210, 70%, 55%)"  # Focused outline (blue)
  border-active: "hsl(210, 60%, 50%)" # Active interactions

  # Text Hierarchy
  text-primary: "hsl(215, 15%, 92%)"  # Bright white-gray for main content
  text-secondary: "hsl(215, 12%, 72%)"# Medium gray for labels/tab names
  text-muted: "hsl(215, 10%, 52%)"    # Low-contrast gray for descriptions/disabled states
  text-accent: "hsl(210, 80%, 72%)"   # Soft blue highlight for links/important keywords

  # Accent (Primary Actions/CTAs)
  accent: "hsl(160, 65%, 35%)"        # Emerald green
  accent-hover: "hsl(160, 65%, 42%)"  # Lighter emerald
  accent-glow: "hsla(160, 80%, 50%, 0.25)" # Emerald drop shadow / back-glow

  # Semantic States (CSS: --color-*)
  color-success: "hsl(155, 55%, 38%)"       # Grass green (run success)
  color-success-bg: "hsl(155, 40%, 10%)"
  color-success-text: "hsl(155, 60%, 78%)"
  color-error: "hsl(0, 72%, 65%)"           # Coral red (failure/compilation errors)
  color-error-bg: "hsl(0, 35%, 12%)"        # Note: No --color-error-text
  color-warning: "hsl(40, 85%, 70%)"        # Warm amber (compilation warnings)
  color-warning-bg: "hsl(40, 30%, 10%)"     # Note: No --color-warning-text
  color-info: "hsl(210, 70%, 68%)"          # Electric blue (starting/running status)

  # Debug Toolbar Colored Elements (--ss-*)
  ss-green: "#10b981"                       # Play/Continue action
  ss-green-light: "#34d399"                 # Active status dot
  ss-blue: "#3b82f6"                        # Step Over/Into/Out actions
  ss-gold: "#f59e0b"                        # Restart action
  ss-red: "#ef4444"                         # Stop debug action
```

### 2. Shadows, Transitions & Glass Effects

```yaml
effects:
  # Shadows (CSS: --shadow-*)
  shadow-sm: "0 1px 3px hsla(0, 0%, 0%, 0.3)"
  shadow-md: "0 4px 12px hsla(0, 0%, 0%, 0.4)"
  shadow-lg: "0 8px 24px hsla(0, 0%, 0%, 0.5)"

  # Transitions (CSS: --transition-*)
  transition-fast: "150ms ease"
  transition-normal: "250ms ease"
  transition-slow: "400ms ease"

  # Glass Effects (CSS: --glass-*)
  glass-bg: "hsla(215, 20%, 12%, 0.7)"
  glass-border: "hsla(215, 15%, 30%, 0.5)"
  glass-blur: "12px"
```

### 3. Typography

```yaml
typography:
  family-sans: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
  family-mono: "\"Cascadia Code\", \"SFMono-Regular\", Consolas, monospace"
  
  sizes:
    brand: { size: "16px", weight: "800", letter-spacing: "-0.01em" }
    tab: { size: "12px", weight: "500" }
    label-caps: { size: "12px", weight: "700", text-transform: "uppercase" }
    code: { size: "13px", line-height: "1.5" }
    ui-text: { size: "13px", line-height: "1.4" }
```

### 4. Spacing & Layout Radius

```yaml
spacing: # CSS: --space-*
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"

radius: # CSS: --radius-*
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "999px"
```

---

## Component Layout Rules

### 1. The App Shell (`.app-shell`)
- **Layout:** Vertical grid (`grid-template-rows: auto 1fr`).
- **Background:** Always uses `bg-base`.

### 2. Topbar (`.topbar`)
- **Aesthetic:** Horizontal header bar spanning the top. Background is a vertical gradient from `bg-layer-2` to `bg-layer-1`. Bottom border is a subtle dual layer: no border-bottom but a box-shadow showing `border-subtle` and inset `border-subtle`. Positioned with `position: relative` and `z-index: 10` to ensure floating elements sit above the editor.
- **Elements:**
  - **Brand logo:** Text is a gradient from `text-primary` to `text-accent`. Icon uses a linear gradient from `accent` to blue (`hsl(210, 60%, 45%)`) with a hover scale of `1.08`.
  - **Toolbar controls:** Execution inputs and run actions.
  - **Status Pill:** Positioned on the right (`margin-left: auto`). Uses a glass border and blur, with background/text colored semantically according to the run state. For starting and running, it pulses and fades in.

### 3. Split Workspace Layout
- **Desktop:** Split into Monaco Editor (top) and Bottom Panel (bottom), split vertically. When debugging is active, a right side panel (`.debug-side-panel`) slides in with width `30%`.
- **Resize Handles:** Drag handles (`.resize-handle` for vertical and `.resize-handle-x` for horizontal) are `6px` wide/high. Default background is `border-subtle`. On hover or drag, they transition to `border-active` or `accent` and fade in a centered grab indicator.

### 4. Glassmorphism Cards (`.input-card`, `.result-card`, `.inspector`)
- **Aesthetic:** Background uses `glass-bg` with `glass-border` border. It uses `backdrop-filter: blur(12px)`.
- **Interaction:** On `:focus-within`, borders highlight with `border-active` and gain an additional `shadow-lg` plus a subtle ring outline.

### 5. Debug Side Panel (`.debug-side-panel`)
- **Tabs:** Located at the top of the side panel. Inactive tabs are `text-secondary` with transparent background. The selected tab has `text-primary` and an active indicator box-shadow at the bottom.
- **Variables & Watches Stack:** Inside the Variables tab, the layout is stacked vertically:
  - Variables Tree (top): collapsible rows with carets.
  - Resize Splitter (`.debug-vsplit`): row resize handle with hover accent.
  - Watches List (bottom): watch expressions list with delete (`×`) icon on hover.
  - Input forms: Single-column block layout with a `8px` vertical gap.
- **Call Stack:** Flat list of stack frames.

### 6. Floating Debug Toolbar (`.debug-toolbar`)
- Floating glassmorphic control pill toolbar positioned in the topbar on active debug.
- **Styling:** 
  - Background is `rgba(18, 22, 30, 0.85)` with `backdrop-filter: blur(12px)`.
  - Border is `1px solid hsla(0, 0%, 100%, 0.08)`.
  - Rounded corners: `var(--radius-pill)`.
  - Dimensions & padding: `padding: 4px 12px; min-height: 38px`.
  - Shadows: `box-shadow: 0 4px 12px hsla(0, 0%, 0%, 0.5)`.
- **Dividers (`.toolbar-separator`):** Vertical separators between button groups styled as `1px` wide by `14px` high with color `hsla(0, 0%, 100%, 0.08)`.
- **Buttons:** 
  - Dimensions & state: `28px` wide by `28px` height, transparent background.
  - Interactive: Hover background is `hsla(0, 0%, 100%, 0.06)`, disabled state has `opacity: 0.4`.
  - Colors (Semantic indicators):
    - `.btn-continue`: `--ss-green`
    - `.btn-step`: `--ss-blue`
    - `.btn-restart`: `--ss-gold`
    - `.btn-stop`: `--ss-red`
- **Active Indicator (`.active-indicator`):** When stopped at a breakpoint, shows an `8px` by `8px` status dot colored with `--ss-green-light`, glowing with `--ss-green`, and utilizing a `2s` pulsing animation.

### 7. Editor Tab Bar (`.editor-tab-bar`) — ISSUE-040

> Added in v1.1.0 for multi-file ephemeral support (C/C++ only; Python remains single-file).
> Proposal demo: `tmp/antigravity-proposals/2026-06-09_editor-tabs-spec.html`

#### Position & Layout

The tab bar sits **between the Topbar and the Monaco Editor panel** (`.editor-panel`). It occupies a new row in the workspace grid.

```
┌────────────────────────────────────────────┐
│  Topbar (.topbar)                          │
├────────┬────────┬────────┬──────┬──────────┤
│ main.c │ math.h │ utils.c│  +   │          │  ← Tab Bar
├────────┴────────┴────────┴──────┴──────────┤
│              Monaco Editor                 │
├────────────────────────────────────────────┤
│           Bottom Panel                     │
└────────────────────────────────────────────┘
```

#### New CSS Custom Properties

```yaml
# Append to :root
tab-bar-height: "32px"
tab-bar-bg: "var(--bg-layer-2)"              # hsl(215, 20%, 11%)
tab-bg-active: "#1e1e1e"                     # VS Dark editor bg — seamless visual join
tab-bg-hover: "hsla(215, 20%, 18%, 0.5)"
tab-text-active: "var(--text-primary)"       # hsl(215, 15%, 92%)
tab-text-inactive: "var(--text-secondary)"   # hsl(215, 12%, 72%)
tab-close-color: "var(--text-muted)"         # hsl(215, 10%, 52%)
tab-close-hover: "var(--color-error)"        # hsl(0, 72%, 65%)
tab-indicator: "var(--accent)"               # emerald hsl(160, 65%, 35%)
tab-min-width: "80px"
tab-max-width: "160px"
tab-add-size: "26px"

# File icon colors (inline SVG stroke/fill)
icon-c:   "hsl(210, 70%, 60%)"              # Blue — .c files
icon-h:   "hsl(280, 50%, 65%)"              # Purple — .h files
icon-cpp: "hsl(210, 80%, 50%)"              # Dark blue — .cpp/.cc files
icon-hpp: "hsl(280, 60%, 60%)"              # Dark purple — .hpp/.hh files
```

#### Tab Bar Container (`.editor-tab-bar`)

- **Layout:** Horizontal flexbox, `align-items: stretch`.
- **Dimensions:** Height `32px`, full width.
- **Background:** `--tab-bar-bg` (`--bg-layer-2`).
- **Border:** Bottom `1px solid --border-subtle`.
- **Overflow:** `overflow-x: auto` with hidden scrollbar (CSS `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`). Mouse wheel scrolls horizontally.

#### Tab Item (`.editor-tab`)

- **Layout:** Inline-flex, `align-items: center`, `gap: 6px`.
- **Dimensions:** Min-width `80px`, max-width `160px`, full height.
- **Padding:** `0 4px 0 10px`.
- **Border-right:** `1px solid --border-subtle` (separator between tabs).
- **Typography:** `12px`, weight `500`, `--font-sans`.
- **Cursor:** `pointer`.

**States:**

| State | Background | Text | Close × |
|-------|-----------|------|---------|
| Inactive | `transparent` | `--tab-text-inactive` | Hidden (`opacity: 0`) |
| Hover | `--tab-bg-hover` | `--text-primary` | Visible (`opacity: 1`) |
| Active | `--tab-bg-active` (`#1e1e1e`) | `--tab-text-active` | Always visible |

**Active tab indicators:**
- **Bottom:** `2px` pseudo-element in `--tab-indicator` (emerald) with `box-shadow: 0 0 6px --accent-glow`. This signals the current file.
- **Bottom edge bridge:** A `1px` pseudo-element colored `--tab-bg-active` placed at `bottom: -1px` to visually merge the tab into the editor (hiding the bar's border-bottom under the active tab).

#### Tab Sub-elements

- **File icon (`.tab-icon`):** Inline SVG, `14×14px`, color-coded by extension. Placed before the label.
- **Label (`.tab-label`):** `flex: 1`, `text-overflow: ellipsis`, `white-space: nowrap`.
- **Close button (`.tab-close`):** `18×18px`, `border-radius: --radius-sm`. Transparent bg, `--tab-close-color`. On hover: bg `hsla(0, 72%, 65%, 0.15)`, color `--tab-close-hover`. Transition `--transition-fast`.

#### File Icons (Inline SVG)

Simple `16×16` SVG: rounded rectangle border + centered letter. No external icon libraries.

| Extension | Letter | Stroke/Fill Color |
|-----------|--------|-------------------|
| `.c` | **C** | `--icon-c` (blue) |
| `.h` | **H** | `--icon-h` (purple) |
| `.cpp`, `.cc` | **C+** | `--icon-cpp` (dark blue) |
| `.hpp`, `.hh` | **H+** | `--icon-hpp` (dark purple) |

#### Add File Button (`.tab-add`)

- **Dimensions:** `26×26px`, centered in tab bar.
- **Margin:** `3px 6px` (vertically centered).
- **Border:** `1px dashed --border-subtle`.
- **Border-radius:** `--radius-sm`.
- **Color:** `--text-muted` → `--text-primary` on hover.
- **Hover bg:** `--tab-bg-hover`.
- **Transition:** `--transition-fast`.
- **Action:** Click inserts an inline `<input>` before the + button for the new filename. Extension auto-suggested based on current language (`.c` for C, `.cpp` for C++).

#### New File Inline Input (`.tab-new-input`)

- **Input:** `120px` wide, `22px` high, `--font-mono 12px`.
- **Border:** `1px solid --border-active`, `--radius-sm`.
- **Focus ring:** `box-shadow: 0 0 0 2px hsla(210, 60%, 50%, 0.2)`.
- **Hint text:** "Enter ✓" in `--text-muted` next to input.
- **Submit:** Enter confirms, Escape cancels, blur confirms.

#### Rename Inline Input (`.tab-rename-input`)

- Triggered by **double-clicking** a tab label.
- Same styling as new-file input but placed inside the tab, replacing the `.tab-label`.
- `90px` wide, `20px` high.
- Enter confirms, Escape reverts, blur confirms.

#### Context Menu (right-click tab)

- **Container:** `position: fixed`, `z-index: 100`, `min-width: 160px`.
- **Background:** `--bg-elevated` with `backdrop-filter: blur(12px)`.
- **Border:** `1px solid --glass-border`, `border-radius: --radius-md`.
- **Shadow:** `--shadow-lg`.
- **Animation:** Fade-in 120ms with 4px translateY.

**Menu items:**

| Item | Icon | Shortcut | Notes |
|------|------|----------|-------|
| Rename | ✏️ | F2 | Triggers inline rename |
| Close | ✕ | — | Disabled when 1 file remains |
| Close Others | ⊘ | — | Closes all tabs except target |
| ─ separator ─ | | | |
| Delete File | 🗑 | — | `--color-error` text, confirm dialog |

**Item states:** Hover bg `hsla(210, 60%, 50%, 0.12)`. Danger items hover bg `hsla(0, 72%, 65%, 0.12)`.

#### Invariants

- **≥ 1 file always:** Close and Delete are disabled on the last remaining tab. If the last file is somehow removed, auto-create `main.<ext>` with empty content.
- **Language-scoped extensions:** Only extensions valid for the current language are accepted (C: `.c`, `.h`; C++: `.cpp`, `.cc`, `.hpp`, `.hh`, `.h`).
- **Language switch:** Changing language shows a confirmation dialog ("Switching language will clear all files. Continue?"), then resets to 1 file `main.<ext>` with `defaultSource`.
- **Breakpoints per-file:** Monaco decorations are per-model, so breakpoint dots automatically track correctly when switching tabs.

---

## Responsive Behavior (Viewport <= 860px)

Though visual testing is desktop-focused, the UI implements responsive behaviors under the `@media (max-width: 860px)` breakpoint:
1. **Topbar (`.topbar`):** Wraps contents (`flex-wrap: wrap`) to prevent horizontal overflow.
2. **Brand (`.brand`):** Expands to full width (`min-width: 100%`).
3. **Resize Handles:** Both `.resize-handle` and `.resize-handle-x` are hidden (`display: none`), disabling dragging on mobile.
4. **Bottom Panel (`.bottom-panel`):** Collapses from side-by-side to a single vertical column (`grid-template-columns: 1fr`).
5. **Content Area (`.content-area.debug-active`):** The right debug side-panel collapses vertically below the main content (`grid-template-columns: 1fr`).
6. **Editor Tab Bar (`.editor-tab-bar`):** The `+` Add button is hidden (`display: none`). Context menu is disabled. Tabs scroll horizontally as normal.

---

## Do's & Don'ts

### Do's
- **Use HSL Variables:** Use the exact HSL/HEX variables specified in this document for coloring and borders.
- **Glassmorphic Cards:** Keep all cards glassmorphic (`backdrop-filter: blur(12px)`) with subtle borders.
- **Enter-to-submit:** Keep Watches and Debug Console inputs submit-on-enter, omitting heavy submit buttons next to inputs.
- **Micro-animations:** Always implement transitions on hover and active states of interactive controls.

### Don'ts
- **No External Font CDNs:** Never attempt to load Google Fonts or other external CDNs in proposal mockups due to CSP blockages in tailnet contexts.
- **No Hardcoded Values:** Do not hardcode layout colors or shadows; use the `--bg-*` and `--shadow-*` CSS tokens.
- **No Flat Debug Colors:** Do not paint debug actions with default gray hover templates; use the pre-colored `--ss-*` semantic states.

---

## Agent Prompt Guide

When writing UI/UX mockups or generating styles for components:
1. **Inject Design Tokens:** Start every CSS block by incorporating the variables mapped in the `colors`, `effects`, `spacing`, and `radius` sections.
2. **Consult [DESIGN.md](DESIGN.md) First:** Never write ad-hoc CSS properties for background or typography sizes. Always look up the component rules in this guide.
3. **Keep Design System Synced:** If a new component styling is designed, document its tokens and parameters in this file before final deployment.
