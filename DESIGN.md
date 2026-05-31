# DESIGN.md — Web-Debugger Design System

This file defines the visual language, design tokens, styling rules, and layout components of the tailnet-only online code runner and debugger. All UI/UX design agents must follow these specifications strictly to maintain aesthetic integrity and consistency.

---
version: 1.0.0
name: Web-Debugger UI
description: A premium, dark-mode developer environment featuring glassmorphic overlays, vibrant emerald green accents, and a precise, developer-centric layout using Monaco and Inter.

## Design Tokens

### Colors

Our color system uses HSL values mapped to deep cool grays, vibrant primary accents, and rich semantic indicators.

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

  # Semantic States
  success: "hsl(155, 55%, 38%)"       # Grass green (run success)
  success-bg: "hsl(155, 40%, 10%)"
  success-text: "hsl(155, 60%, 78%)"
  error: "hsl(0, 72%, 65%)"           # Coral red (failure/compilation errors)
  error-bg: "hsl(0, 35%, 12%)"
  warning: "hsl(40, 85%, 70%)"        # Warm amber (compilation warnings)
  warning-bg: "hsl(40, 30%, 10%)"
  info: "hsl(210, 70%, 68%)"          # Electric blue (starting/running status)

  # Glass Effect
  glass-bg: "hsla(215, 20%, 12%, 0.7)"
  glass-border: "hsla(215, 15%, 30%, 0.5)"
```

### Typography

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

### Spacing & Layout Rhythm

```yaml
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"

radius:
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
- **Aesthetic:** Horizontal header bar spanning the top. Background is a vertical gradient from `bg-layer-2` to `bg-layer-1`. Bottom border is a subtle dual layer: no border-bottom but a box-shadow showing `border-subtle` and inset `border-subtle`.
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
  - Variables Tree (top): collapsible rows with caret icons.
  - Resize Splitter (`.debug-vsplit`): row resize handle with hover accent.
  - Watches List (bottom): watch expressions list with delete (`×`) icon on hover.
  - Input forms: Single-column block layout with a `8px` vertical gap.
- **Call Stack:** Flat list of stack frames.

### 6. Floating Debug Toolbar (`.debug-toolbar`)
- Floating pill-shaped control strip positioned in the topbar on active debug.
- **Styling:** Pill border uses `border-default`, background is `bg-elevated`, with a shadow. Buttons inside are icon-only, transparent backgrounds, changing to `hsla(0, 0%, 100%, 0.1)` on hover with no translation or border.
- **Stop button:** High-priority red highlight (`color-error`).

---

## Design Principles for Proposals

1. **Vibrant Aesthetics over Plain Colors:**
   - Never use standard browser colors or pure primary hues.
   - Use HSL-tailored colors. All gradients must use smooth transitions (e.g. 135deg).
2. **Glassmorphism & Depth:**
   - Leverage `backdrop-filter: blur(12px)` and thin semi-transparent borders for overlays and panels.
   - Use layered backgrounds starting from the deepest `#12141a` base.
3. **Smooth Micro-animations:**
   - All interactive controls (buttons, tabs, inputs) must include CSS transitions for background, transform, and box-shadow.
   - Status pills must pulse during asynchronous phases (starting, running, long-running).
4. **Input Clarity:**
   - Forms and inputs must span full width, with `box-sizing: border-box`, clear `outline-offset` focuses, and distinct margins.
