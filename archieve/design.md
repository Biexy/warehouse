# Design — Warehouse Control

A locked design system for the Arabic inventory application. Every view uses
this file as its source of truth.

## Genre

Modern-minimal, adapted for a dense operational dashboard.

## Macrostructure family

- App views: **Workbench** — persistent operational navigation, compact metrics, tabular work areas, and forms beside the data they change.
- Login: **Split diptych** — identity and system status on one side, the single sign-in action on the other.
- Reports: **Tabular spec sheet** — visible values and labelled thresholds; colour is never the only signal.

## Theme

- Paper: dark, cool navy `oklch(13% 0.018 248)`.
- Elevated surfaces: `oklch(17% 0.022 248)` and `oklch(21% 0.024 248)`.
- Ink: cool off-white `oklch(95% 0.012 240)`.
- Signal accent: cyan `oklch(78% 0.15 220)`, kept below 5% of each view.
- Semantic states use green, amber, and red plus icons and text labels.

## Typography

- Display: Noto Kufi Arabic, weight 700, roman.
- Body: Cairo, weights 400 and 700.
- Codes and document identifiers: IBM Plex Mono; this is the one outlier role.
- Minimum body size: 16px; all metrics use tabular figures.

## Spacing

Four-point named scale in `tokens.css`. Components consume named tokens only.

## Motion

- Two primitives: button press and modal crossfade/scale.
- Data values may tick once after loading; reduced-motion renders final values immediately.
- No decorative scroll animation.

## Microinteractions stance

- Visible results use silent success; failures use actionable toasts.
- Every form has default, hover, focus, active, disabled, loading, error, and success treatments.
- Focus rings are immediate. All touch targets are at least 44px.

## Navigation and footer

- Navigation: N13-inspired search-led app bar; grouped search, keyboard navigation, Escape close.
- Footer: Ft2 compact single-line system/status footer.
- Mobile navigation becomes a five-action bottom bar; tables become labelled cards.

## Role model

- `ADMIN`: users, items, movements, reports, backups.
- `STOREKEEPER`: items read, movement create/reverse, reports.
- `AUDITOR`: read-only dashboard, inventory, movements, reports.

## What views must share

- RTL direction, wordmark, palette, font roles, button geometry, focus treatment, and status language.
- Server-enforced role checks; hiding a control never counts as authorization.
- Codes, dates, and quantities use `dir="auto"` or LTR isolation inside the RTL interface.

## Dashboard analytics

- The dashboard summarizes the full inventory; it never tries to render every SKU at once.
- Primary metrics are SKU/status and movement-document counts. Raw quantities may be shown as supporting detail, with an explicit warning when item units differ.
- The operator can compare 7, 30, or 90 days. The movement chart plots daily incoming/outgoing document counts and exposes the same values in an accessible table.
- Stock health uses a labelled distribution bar plus exact counts; colour is supplementary.
- The action queue is capped and sorted with out-of-stock items first, then lowest reorder-level coverage. Selecting a row opens the filtered Items view.

## Incoming and outgoing workflow

- Entry points are always distinct: **إدخال مخزون** and **صرف مخزون**. The dialog still allows switching type through the original two-card incoming/outgoing control.
- Item selection is searchable by code or name and supports server-side lookup when the catalog is too large for the bootstrap payload.
- After selecting an item, show its unit, current balance, reorder level, and a current → projected balance preview before posting.
- Document date, document/invoice number, party, and quantity are required. Apps Script records the authoritative server timestamp and authenticated operator.
- Posted movements are append-only. Corrections create a separately audited reversal instead of editing or deleting the source movement.

## Exports

### tokens.css

The canonical file is [`tokens.css`](tokens.css). Its complete `:root` block is
the source of truth.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(13% 0.018 248);
  --color-paper-2: oklch(17% 0.022 248);
  --color-paper-3: oklch(21% 0.024 248);
  --color-rule: oklch(32% 0.025 245);
  --color-muted: oklch(68% 0.018 240);
  --color-ink: oklch(95% 0.012 240);
  --color-accent: oklch(78% 0.15 220);
  --color-focus: oklch(84% 0.19 220);
  --font-display: "Noto Kufi Arabic", sans-serif;
  --font-body: "Cairo", sans-serif;
  --font-outlier: "IBM Plex Mono", monospace;
  --spacing-xs: 0.75rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --radius-card: 1rem;
  --radius-input: 0.75rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(13% 0.018 248)", "$type": "color" },
    "paper-2": { "$value": "oklch(17% 0.022 248)", "$type": "color" },
    "ink": { "$value": "oklch(95% 0.012 240)", "$type": "color" },
    "muted": { "$value": "oklch(68% 0.018 240)", "$type": "color" },
    "accent": { "$value": "oklch(78% 0.15 220)", "$type": "color" },
    "focus": { "$value": "oklch(84% 0.19 220)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Noto Kufi Arabic, Cairo, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "Cairo, Noto Sans Arabic, sans-serif", "$type": "fontFamily" },
    "outlier": { "$value": "IBM Plex Mono, monospace", "$type": "fontFamily" }
  },
  "space": {
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" }
  },
  "duration": {
    "micro": { "$value": "120ms", "$type": "duration" },
    "short": { "$value": "220ms", "$type": "duration" },
    "long": { "$value": "420ms", "$type": "duration" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 13% 0.018 248;
  --foreground: 95% 0.012 240;
  --card: 17% 0.022 248;
  --card-foreground: 95% 0.012 240;
  --popover: 21% 0.024 248;
  --popover-foreground: 95% 0.012 240;
  --primary: 78% 0.15 220;
  --primary-foreground: 16% 0.025 245;
  --secondary: 21% 0.024 248;
  --secondary-foreground: 80% 0.014 240;
  --muted: 32% 0.025 245;
  --muted-foreground: 68% 0.018 240;
  --destructive: 65% 0.20 25;
  --destructive-foreground: 13% 0.018 248;
  --border: 32% 0.025 245;
  --input: 32% 0.025 245;
  --ring: 84% 0.19 220;
  --radius: 1rem;
}
```
