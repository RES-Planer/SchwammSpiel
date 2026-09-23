import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { App } from './app';
import { parseHashRoute } from './hashRoute';
import { SteckbriefPage } from './SteckbriefPage';
import './index.css';

function Root() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const route = parseHashRoute(hash);
  if (route.kind === 'steckbrief') {
    return <SteckbriefPage scenarioPayload={route.scenarioPayload} />;
  }
  return <App />;
}

render(<Root />, document.getElementById('app')!);
