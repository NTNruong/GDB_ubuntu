---
version: 1.0.0
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

---

## Responsive Behavior (Viewport <= 860px)

Though visual testing is desktop-focused, the UI implements responsive behaviors under the `@media (max-width: 860px)` breakpoint:
1. **Topbar (`.topbar`):** Wraps contents (`flex-wrap: wrap`) to prevent horizontal overflow.
2. **Brand (`.brand`):** Expands to full width (`min-width: 100%`).
3. **Resize Handles:** Both `.resize-handle` and `.resize-handle-x` are hidden (`display: none`), disabling dragging on mobile.
4. **Bottom Panel (`.bottom-panel`):** Collapses from side-by-side to a single vertical column (`grid-template-columns: 1fr`).
5. **Content Area (`.content-area.debug-active`):** The right debug side-panel collapses vertically below the main content (`grid-template-columns: 1fr`).

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
