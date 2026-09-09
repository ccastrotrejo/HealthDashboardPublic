import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { loadAthleteConfig } from './athlete-config.js';
import { readRegularFile } from './files.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const configModule = '\0athlete-config';

/** Only derived, browser-consumed artifacts cross the private storage boundary. */
export const DASHBOARD_ARTIFACTS = [
  'snapshot.json', 'races.json', 'insights.json', 'today-debrief.json',
  'monthly-patterns.json', 'coach.json', 'weekly-review.json',
  'race-week.json', 'post-race.json', 'calibration.json',
] as const;

export function readDashboardArtifact(name: string, directory = root): string | null {
  if (!DASHBOARD_ARTIFACTS.some((artifact) => artifact === name)) return null;
  try {
    return readRegularFile(directory, `private/data/${name}`).toString('utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Vite resolves this import to data, never to the Node credential/filesystem layer. */
export function athleteConfigPlugin(exampleOnly = false): Plugin {
  return {
    name: 'athlete-config',
    enforce: 'pre',
    resolveId(id) {
      if (id === '#athlete-config') return configModule;
    },
    load(id) {
      if (id === configModule) {
        return `export default ${JSON.stringify(loadAthleteConfig(root, exampleOnly))};`;
      }
    },
  };
}

export function dashboardAssetsPlugin(): Plugin {
  return {
    name: 'dashboard-artifacts',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0] ?? '';
        if (!pathname.startsWith('/data/')) return next();
        try {
          const contents = readDashboardArtifact(pathname.slice('/data/'.length));
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Content-Type', 'application/json');
          response.statusCode = contents === null ? 404 : 200;
          response.end(contents ?? '{"error":"Artifact not found"}');
        } catch (error) {
          next(error);
        }
      });
    },
    generateBundle() {
      for (const name of DASHBOARD_ARTIFACTS) {
        const source = readDashboardArtifact(name);
        if (source !== null) this.emitFile({ type: 'asset', fileName: `data/${name}`, source });
      }
    },
  };
}
