---
name: frontend-pro
description: Use this skill for any front-end / UI work — building, refactoring, debugging, or reviewing components, styling, responsiveness, state management, accessibility, and performance in web apps (React, Vue, Svelte, plain HTML/CSS/JS, Tailwind, etc.). Triggers on requests involving UI, components, layout, styling, pages, forms, design systems, or front-end bugs.
---

# Frontend Pro

A rigorous workflow for producing high-quality, production-ready front-end code.

## 0. Detect the stack first
Before writing anything, identify the project's front-end stack:
- Framework: React / Vue / Svelte / Solid / Angular / none (vanilla)
- Language: TypeScript or JavaScript (prefer TS when available)
- Styling: Tailwind / CSS Modules / styled-components / plain CSS / Sass
- Build tool: Vite / Next.js / webpack / none
- State: built-in hooks / Redux / Zustand / Pinia / Context / none

Run quick checks:
- `Read` package.json to find dependencies and scripts.
- Look for config files: `vite.config.*`, `tailwind.config.*`, `tsconfig.json`, `next.config.*`.
- Match existing conventions — never introduce a new library unless the project already uses it or the user explicitly asks.

## 1. Understand the requirement
- Read the relevant existing components/files before editing.
- Identify the exact UI behavior, edge cases, and data flow.
- Note responsive breakpoints, supported browsers, and accessibility needs.

## 2. Component design principles
- **Single responsibility**: one component does one thing well.
- **Composition over inheritance**: build small reusable pieces.
- **Props over config objects** when fewer than ~5 inputs; use typed interfaces.
- **Colocate** styles, tests, and types with the component when the project allows.
- Extract repeated markup into a shared component or map over data.

### TypeScript interface example (React)
```tsx
interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}
```

## 3. Styling rules
- Prefer utility classes (Tailwind) or scoped CSS — avoid global style leaks.
- Use semantic, mobile-first responsive design.
- Keep a consistent spacing/color/typography scale (design tokens).
- Support `prefers-reduced-motion` and dark-mode where relevant.
- Avoid magic numbers; name constants.

## 4. Accessibility (non-negotiable)
- Use semantic HTML (`button`, `nav`, `main`, `label`, `ul`/`li`).
- All interactive elements keyboard-navigable and focus-visible.
- Provide `alt` text, `aria-label`, `aria-live` for dynamic regions.
- Color contrast meets WCAG AA.
- Forms: associate labels, show validation errors with `aria-invalid` + `role="alert"`.

## 5. State & data
- Lift state only as high as needed; keep local state local.
- Derive values with `useMemo`/`computed` instead of duplicating state.
- Handle loading, empty, error, and success states explicitly.
- Never trust unvalidated external data; validate at boundaries.

## 6. Performance
- Memoize expensive computations and stable callbacks.
- Virtualize long lists (>100 items).
- Lazy-load routes/components with `React.lazy` / dynamic import.
- Avoid layout thrash; batch DOM reads/writes.
- Use `content-visibility: auto` for offscreen heavy sections when helpful.

## 7. Implementation checklist
- [ ] Matches existing code style and naming.
- [ ] No unused imports/vars; types complete.
- [ ] Responsive at 320 / 768 / 1280px.
- [ ] Keyboard + screen-reader tested (reason about it).
- [ ] Loading/error/empty states handled.
- [ ] No console errors or memory leaks (cleanup effects).

## 8. After writing
- Run the project's lint/typecheck/build if available:
  - `npm run lint`, `npm run typecheck`, `npm run build` (or `pnpm`/`yarn` equivalents).
- Fix issues before reporting done.
- Do NOT add explanatory comments to code unless the user asks.

## 9. Review mode
When asked to review front-end code, check against sections 3–7 and report concrete, actionable fixes ranked by impact (a11y/bugs first, polish last).
