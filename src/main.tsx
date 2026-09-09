import React from 'react';
import ReactDOM from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { healthTheme } from './lib/health';
import { ThemeModeProvider, useThemeMode } from './hooks/useThemeMode';
import App from './App';

/** Self-hosted product typography. */
import '@fontsource-variable/archivo';
import '@fontsource-variable/jetbrains-mono';

import './styles/globals.css';
import './lib/health.css';
import './styles/liquid-glass.css';
import './styles/three-view.css';

/**
 * Bridges the persisted theme choice into Astryx's `<Theme>`. Kept as a thin
 * inner component so the mode state lives above `<Theme>` while the header
 * toggle (deep in `<App>`) reads the same context.
 */
function ThemedApp() {
  const { mode } = useThemeMode();
  return (
    <Theme theme={healthTheme} mode={mode}>
      <App />
    </Theme>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <ThemedApp />
    </ThemeModeProvider>
  </React.StrictMode>,
);
