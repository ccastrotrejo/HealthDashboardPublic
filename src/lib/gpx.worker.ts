import { importGpxFile } from './gpxImport';
import type { GpxWorkerRequest, GpxWorkerResponse } from './gpxWorkerProtocol';

self.onmessage = async (event: MessageEvent<GpxWorkerRequest>) => {
  const { requestId, file } = event.data;
  try {
    const result = await importGpxFile(file);
    const response: GpxWorkerResponse = { requestId, type: 'success', result };
    self.postMessage(response);
  } catch (cause) {
    const response: GpxWorkerResponse = {
      requestId, type: 'error',
      message: cause instanceof Error ? cause.message : 'The GPX could not be processed. Try another file.',
    };
    self.postMessage(response);
  }
};
