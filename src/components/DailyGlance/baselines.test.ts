import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HrvCard } from './HrvCard';
import { RhrCard } from './RhrCard';

describe('shared recovery baselines', () => {
  it.each([
    { name: 'HRV', Component: HrvCard, unit: 'ms' },
    { name: 'resting HR', Component: RhrCard, unit: 'bpm' },
  ])('preserves the $name baseline and missing-data distinction', ({ Component, unit }) => {
    const render = (values: Array<number | null>) => renderToStaticMarkup(createElement(Component, {
      latest: null, deltaPct: null,
      trend: values.map((value, index) => ({ date: `2026-09-0${index + 1}`, value })),
    }));
    expect(render([40, null, 60])).toContain(`50 ${unit}`);
    expect(render([0, null, 0])).toContain(`0 ${unit}`);
    expect(render([null, null])).toContain('unavailable');
    expect(render([])).toContain('unavailable');
  });
});
