export type HashRoute =
  | { kind: 'app' }
  | {
      kind: 'steckbrief';
      scenarioPayload: string | null;
      rainEventId: string | null;
    };

export function parseHashRoute(hash: string): HashRoute {
  const trimmedHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = trimmedHash.match(/^\/steckbrief\/?(?:\?(.*))?$/);
  if (!match) {
    return { kind: 'app' };
  }

  const params = new URLSearchParams(match[1] ?? '');
  return {
    kind: 'steckbrief',
    scenarioPayload: params.get('scenario'),
    rainEventId: params.get('rainEventId'),
  };
}
