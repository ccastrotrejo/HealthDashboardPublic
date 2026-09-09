import { parseGpx, projectRoute } from './route';
import { MAX_GPX_BYTES } from './routeLimits';
import type { GpxImportResult } from './gpxWorkerProtocol';

/** Worker-only pipeline: the main thread sends the Blob, never reads or parses its contents. */
export async function importGpxFile(file: Blob): Promise<GpxImportResult> {
  if (file.size > MAX_GPX_BYTES) throw new Error('GPX files must be 5 MiB or smaller.');
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error('The GPX could not be read. Try another file.');
  }
  const route = parseGpx(text);
  return { route, projection: projectRoute(route) };
}
