import {
  analyzeLocalFlowRouting,
  type LocalTerrainAnalysis,
  type LocalTerrainMeasure,
  type TerrainWindow,
} from './localFlowRouting';

export type LocalFlowRoutingWorkerRequest = {
  id: number;
  measureId: string;
  window: TerrainWindow;
  measure: LocalTerrainMeasure;
};

export type LocalFlowRoutingWorkerResponse =
  | {
      id: number;
      measureId: string;
      ok: true;
      analysis: LocalTerrainAnalysis;
    }
  | {
      id: number;
      measureId: string;
      ok: false;
      error: string;
    };

self.onmessage = (event: MessageEvent<LocalFlowRoutingWorkerRequest>) => {
  try {
    const analysis = analyzeLocalFlowRouting(event.data.window, event.data.measure);
    const response: LocalFlowRoutingWorkerResponse = {
      id: event.data.id,
      measureId: event.data.measureId,
      ok: true,
      analysis,
    };
    self.postMessage(response);
  } catch (error) {
    const response: LocalFlowRoutingWorkerResponse = {
      id: event.data.id,
      measureId: event.data.measureId,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown local flow routing error',
    };
    self.postMessage(response);
  }
};
