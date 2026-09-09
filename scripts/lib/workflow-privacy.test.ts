import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflows = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const files = readdirSync(workflows).filter((file) => /^(?:daily-sync|run-all|_ai-generate|ai-.+)\.yml$/.test(file));
const gate = 'github.event.repository.private == true';

describe('private-only pipeline workflows', () => {
  it('covers scheduled wrappers, run-all, and both reusable entrypoints', () => {
    expect(files).toEqual(expect.arrayContaining([
      'daily-sync.yml', 'run-all.yml', '_ai-generate.yml', 'ai-coach.yml',
      'ai-insights.yml', 'ai-monthly-patterns.yml', 'ai-race.yml',
      'ai-today-debrief.yml', 'ai-weekly-review.yml',
    ]));
  });

  it.each(files)('%s hard-gates every job, including jobs continuing after failure', (file) => {
    const text = readFileSync(workflows + file, 'utf8');
    const jobs = text.split(/^jobs:\s*$/m)[1];
    expect(jobs).toBeDefined();
    const blocks = jobs!.split(/^  [\w-]+:\s*$/m).slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const condition = /^    if: (.+)$/m.exec(block)?.[1];
      expect(condition, `Missing hard gate in ${file}`).toMatch(
        /^\$\{\{ github\.event\.repository\.private == true(?: && !cancelled\(\))? \}\}$/,
      );
    }
    expect(text).not.toContain('public/data');
  });

  it.each(['daily-sync.yml', '_ai-generate.yml'])('%s gates data commits and includes newly ignored files', (file) => {
    const text = readFileSync(workflows + file, 'utf8');
    const commit = text.split(/      - name: Commit[^\n]*\n/)[1]?.split(/^      - name:/m)[0];
    expect(commit).toBeDefined();
    expect(commit).toContain(gate);
    expect(commit).toMatch(/if: \$\{\{ (?:always\(\) && )?github\.event\.repository\.private == true \}\}/);
    expect(commit).toContain('git add -f -A private/data/');
  });

  it('uses an explicit optional timezone override rather than a personal default', () => {
    const text = readFileSync(workflows + '_ai-generate.yml', 'utf8');
    expect(text).toContain('USER_TIMEZONE: ${{ vars.USER_TIMEZONE }}');
  });
});
