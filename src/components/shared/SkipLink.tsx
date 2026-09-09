/** Keyboard-only shortcut to bypass repeated page navigation. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="fixed left-3 top-3 z-50 -translate-y-20 rounded-lg bg-ink-900 px-4 py-3 text-sm font-semibold text-ink-50 shadow-border focus-visible:translate-y-0"
    >
      Skip to Content
    </a>
  );
}
