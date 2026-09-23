export type HashRoute =
  | { kind: 'app' }
  | {
      kind: 'steckbrief';
      scenarioPayload: string | null;
    };

export function parseHashRoute(hash: string): HashRoute {
  const trimmedHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!trimmedHash.startsWith('/steckbrief')) {
    return { kind: 'app' };
  }

  const queryStart = trimmedHash.indexOf('?');
  const params = new URLSearchParams(queryStart >= 0 ? trimmedHash.slice(queryStart + 1) : '');
  return {
    kind: 'steckbrief',
    scenarioPayload: params.get('scenario'),
  };
}
