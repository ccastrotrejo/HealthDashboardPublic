// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreeView } from './ThreeView';

const graphics = vi.hoisted((): {
  fail: boolean;
  mounts: number;
  onUnavailable: ((message: string) => void) | null;
} => ({
  fail: true,
  mounts: 0,
  onUnavailable: null,
}));

// The graphics boundary is simulated; ThreeView's state and controls are real.
vi.mock('./ThreeCanvas', async () => {
  const { createElement, useEffect } = await import('react');
  return {
    ThreeCanvas({ onUnavailable }: { onUnavailable: (message: string) => void }) {
      useEffect(() => {
        graphics.mounts++;
        graphics.onUnavailable = onUnavailable;
        if (graphics.fail) onUnavailable('Graphics unavailable; the 2D view is shown.');
      }, [onUnavailable]);
      return createElement('canvas', { 'data-testid': 'graphics' });
    },
  };
});

beforeEach(() => {
  graphics.fail = true;
  graphics.mounts = 0;
  graphics.onUnavailable = null;
});
afterEach(cleanup);

function renderView() {
  return render(createElement(ThreeView, {
    label: 'Route shape',
    scene: { kind: 'route', segments: [], selectedPoint: null },
    interactive: true,
    fallback: createElement('p', null, 'Original 2D route'),
  }));
}

describe('3D fallback and retry', () => {
  it('returns to an unpressed 2D state after a live graphics failure', async () => {
    graphics.fail = false;
    const user = userEvent.setup();
    renderView();
    const toggle = screen.getByRole('button', { name: 'Route shape 3D view' });
    await user.click(toggle);
    await screen.findByTestId('graphics');
    expect(graphics.onUnavailable).not.toBeNull();
    act(() => graphics.onUnavailable?.('Graphics context lost; the 2D view is shown.'));
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByTestId('graphics')).toBeNull();
    await user.click(toggle);
    await screen.findByTestId('graphics');
    expect(graphics.mounts).toBe(2);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('announces the actual fallback state and retries with one click', async () => {
    const user = userEvent.setup();
    renderView();
    const toggle = screen.getByRole('button', { name: 'Route shape 3D view' });
    await user.click(toggle);
    await screen.findByText('Graphics unavailable; the 2D view is shown.');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByTestId('graphics')).toBeNull();
    expect(screen.getByText('Original 2D route')).toBeTruthy();

    graphics.fail = false;
    await user.click(toggle);
    await screen.findByTestId('graphics');
    expect(graphics.mounts).toBe(2);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Graphics unavailable; the 2D view is shown.')).toBeNull();
    expect(screen.getByRole('slider', { name: 'Rotation' })).toBeTruthy();
  });

  it('keeps keyboard toggling and repeated failure retries usable', async () => {
    const user = userEvent.setup();
    renderView();
    const toggle = screen.getByRole('button', { name: 'Route shape 3D view' });
    toggle.focus();
    await user.keyboard(' ');
    await screen.findByText('Graphics unavailable; the 2D view is shown.');
    await user.keyboard('{Enter}');
    await screen.findByText('Graphics unavailable; the 2D view is shown.');
    expect(graphics.mounts).toBe(2);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    graphics.fail = false;
    await user.keyboard(' ');
    await screen.findByTestId('graphics');
    await user.keyboard(' ');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Original 2D route')).toBeTruthy();
    expect(screen.queryByTestId('graphics')).toBeNull();
  });
});
