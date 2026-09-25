import { afterEach, describe, expect, test, vi } from 'vitest';

type MockWorkerSelf = {
  onmessage?: (event: MessageEvent<unknown>) => void;
  postMessage: ReturnType<typeof vi.fn>;
};

async function loadWorker(query: string): Promise<MockWorkerSelf> {
  const workerSelf: MockWorkerSelf = {
    postMessage: vi.fn(),
  };
  vi.stubGlobal('self', workerSelf);
  void query;
  vi.resetModules();
  await import('./localFlowRouting.worker.ts');
  return workerSelf;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('localFlowRouting.worker', () => {
  test('posts ok responses for valid routing requests', async () => {
    const workerSelf = await loadWorker('success');
    workerSelf.onmessage?.({
      data: {
        id: 1,
        measureId: 'swale-1',
        window: {
          width: 6,
          height: 6,
          cellSizeM: 2,
          elevationsM: Array.from({ length: 36 }, (_, index) => 100 - Math.floor(index / 6)),
        },
        measure: {
          kind: 'swale',
          coordinates: [
            [2, 6],
            [10, 6],
          ],
          bottomWidthM: 2,
          depthM: 1,
          sideSlopeM: 2,
        },
      },
    } as MessageEvent<unknown>);

    expect(workerSelf.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        measureId: 'swale-1',
        ok: true,
        analysis: expect.objectContaining({
          capturedAreaShare: expect.any(Number),
        }),
      }),
    );
  });

  test('maps thrown analysis errors into ok:false responses', async () => {
    const workerSelf = await loadWorker('error');
    workerSelf.onmessage?.({
      data: {
        id: 2,
        measureId: 'swale-2',
        window: {
          width: 0,
          height: 6,
          cellSizeM: 2,
          elevationsM: [],
        },
        measure: {
          kind: 'swale',
          coordinates: [
            [2, 6],
            [10, 6],
          ],
          bottomWidthM: 2,
          depthM: 1,
          sideSlopeM: 2,
        },
      },
    } as MessageEvent<unknown>);

    expect(workerSelf.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 2,
        measureId: 'swale-2',
        ok: false,
        error: expect.stringContaining('width'),
      }),
    );
  });
});
