import type { Catchment } from '@schwammspiel/engine';
import { useEffect, useMemo, useState } from 'preact/hooks';

import { locales, type Locale, t } from './i18n';
import { buildDataUrl, resolveCatchmentId } from './mapData';
import type { MeasureState } from './scenarioState';
import { decodeScenarioState, isScenarioState } from './scenarioState';

type Props = {
  scenarioPayload: string | null;
};

export function SteckbriefPage({ scenarioPayload }: Props) {
  const locale = useMemo<Locale>(() => {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get('lang');
    return locales.includes(candidate as Locale) ? (candidate as Locale) : 'de';
  }, []);
  const catchmentId = useMemo(() => resolveCatchmentId(window.location.search), []);
  const [catchment, setCatchment] = useState<Catchment | null>(null);
  const [measures, setMeasures] = useState<MeasureState[] | null>(null);
  const [loadErrorKey, setLoadErrorKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadScenario(): Promise<void> {
      if (!scenarioPayload) {
        setLoadErrorKey('steckbrief.error.noScenario');
        return;
      }
      try {
        const decoded = await decodeScenarioState(scenarioPayload);
        if (!isScenarioState(decoded) || decoded.catchmentId !== catchmentId) {
          if (!cancelled) {
            setLoadErrorKey('steckbrief.error.invalidScenario');
          }
          return;
        }
        if (!cancelled) {
          setMeasures(decoded.measures);
        }
      } catch {
        if (!cancelled) {
          setLoadErrorKey('steckbrief.error.invalidScenario');
        }
      }
    }

    void loadScenario();
    return () => {
      cancelled = true;
    };
  }, [catchmentId, scenarioPayload]);

  useEffect(() => {
    let cancelled = false;
    async function loadCatchment(): Promise<void> {
      try {
        const response = await fetch(buildDataUrl(import.meta.env.BASE_URL, catchmentId, 'catchment.json'));
        if (!response.ok) {
          throw new Error('catchment');
        }
        const loaded = (await response.json()) as Catchment;
        if (!cancelled) {
          setCatchment(loaded);
        }
      } catch {
        if (!cancelled) {
          setLoadErrorKey('map.loadError');
        }
      }
    }

    void loadCatchment();
    return () => {
      cancelled = true;
    };
  }, [catchmentId]);

  return (
    <main className="steckbrief-shell">
      <header className="steckbrief-header">
        <strong>{t(locale, 'steckbrief.disclaimer')}</strong>
        <div className="steckbrief-actions">
          <button type="button" onClick={() => window.print()}>
            {t(locale, 'steckbrief.print')}
          </button>
          <a href={`${window.location.pathname}${window.location.search}`}>{t(locale, 'steckbrief.back')}</a>
        </div>
      </header>

      <section className="steckbrief-page">
        <h1>{t(locale, 'steckbrief.title')}</h1>
        {loadErrorKey ? <p className="warning-text">{t(locale, loadErrorKey)}</p> : null}
        {!loadErrorKey && (!catchment || !measures) ? <p>{t(locale, 'steckbrief.loading')}</p> : null}
        {!loadErrorKey && catchment && measures ? (
          <>
            <h2>{t(locale, 'steckbrief.section.overview')}</h2>
            <dl className="score-grid">
              <div>
                <dt>{t(locale, 'steckbrief.catchment')}</dt>
                <dd>{catchment.name ?? catchmentId}</dd>
              </div>
              <div>
                <dt>{t(locale, 'steckbrief.measureCount')}</dt>
                <dd>{measures.length}</dd>
              </div>
              <div>
                <dt>{t(locale, 'steckbrief.rainEvent')}</dt>
                <dd>{catchment.rainEvents[0]?.name ?? catchment.rainEvents[0]?.id ?? '–'}</dd>
              </div>
            </dl>

            <h2>{t(locale, 'steckbrief.measures')}</h2>
            {measures.length > 0 ? (
              <ul className="measure-list">
                {measures.map((measure) => (
                  <li key={measure.id} className="measure-card">
                    <strong>{measure.id}</strong>
                    <span>{t(locale, `measure.tool.${measure.kind}`)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t(locale, 'steckbrief.emptyMeasures')}</p>
            )}
            <p className="scenario-note">{t(locale, 'app.scenarioNote')}</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
