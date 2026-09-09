import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { athleteConfigSchema, type AthleteConfig } from '../../config/schema.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Only a missing private configuration uses the explicitly fictional example. */
export function loadAthleteConfig(directory = root, exampleOnly = false): AthleteConfig {
  const privatePath = resolve(directory, 'private/athlete.json');
  const examplePath = resolve(directory, 'config/athlete.example.json');
  let raw: string;
  try {
    raw = readFileSync(exampleOnly ? examplePath : privatePath, 'utf8');
  } catch (error) {
    if (!exampleOnly && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      raw = readFileSync(examplePath, 'utf8');
    } else {
      throw error;
    }
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Athlete configuration must contain valid JSON');
  }
  const parsed = athleteConfigSchema.safeParse(input);
  if (!parsed.success) {
    // Validation messages may contain private values or unknown credential keys.
    throw new Error('Invalid athlete configuration; compare it with config/schema.ts');
  }
  return parsed.data;
}

export default loadAthleteConfig(root, process.env.NODE_ENV === 'test');
