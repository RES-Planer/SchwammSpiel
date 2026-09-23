import { evaluateScenario, type Catchment } from '@schwammspiel/engine';

type EvaluationRequest = {
  id: number;
  catchment: Catchment;
  rainEventId: string;
  measuresOn: boolean;
};

type EvaluationResponse =
  | {
      id: number;
      ok: true;
      result: ReturnType<typeof evaluateScenario>;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

self.onmessage = (event: MessageEvent<EvaluationRequest>) => {
  try {
    const result = evaluateScenario(event.data.catchment, event.data.rainEventId, event.data.measuresOn);
    const response: EvaluationResponse = {
      id: event.data.id,
      ok: true,
      result,
    };
    self.postMessage(response);
  } catch (error) {
    const response: EvaluationResponse = {
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown evaluation error',
    };
    self.postMessage(response);
  }
};
