import type { RouteData, RouteProjection } from './route';

export interface GpxImportResult {
  route: RouteData;
  projection: RouteProjection;
}

export interface GpxWorkerRequest {
  requestId: number;
  file: Blob;
}

export type GpxWorkerResponse =
  | { requestId: number; type: 'success'; result: GpxImportResult }
  | { requestId: number; type: 'error'; message: string };
