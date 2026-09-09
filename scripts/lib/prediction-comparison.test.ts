import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RacePredictionComparison } from '../../src/components/LongTerm/RacePredictionComparison';

describe('race prediction comparison', () => {
  it('keeps independent models in labeled columns and retains missing values', () => {
    const markup = renderToStaticMarkup(createElement(RacePredictionComparison, {
      riegel: [{ bucket: '5k', distanceMeters: 5000, predictedSeconds: 1500, paceSecPerKm: 300 }],
      garmin: [{ bucket: '10k', distanceMeters: 10000, predictedSeconds: 3300 }],
    }));

    expect(markup).toContain('scope="col"');
    expect(markup).toContain('Riegel');
    expect(markup).toContain('Garmin');
    expect(markup).toContain('25m 0s');
    expect(markup).toContain('55m 0s');
    expect(markup.match(/Unavailable/g)).toHaveLength(2);
    expect(markup).toContain('Neither is a performance guarantee');
  });

  it('uses a compact, actionable empty state without a fabricated comparison', () => {
    const markup = renderToStaticMarkup(createElement(RacePredictionComparison, {
      riegel: [],
      garmin: null,
    }));

    expect(markup).toContain('No estimates yet');
    expect(markup).not.toContain('<table');
  });
});
