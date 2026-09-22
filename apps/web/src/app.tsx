import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'preact/hooks';

import { locales, type Locale, t } from './i18n';
import './app.css';

export function App() {
  const [locale, setLocale] = useState<Locale>('de');
  const mapElementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mapElement = mapElementRef.current;
    if (!mapElement) {
      return undefined;
    }

    const map = new maplibregl.Map({
      container: mapElement,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: t('de', 'map.attribution'),
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: [11.93, 49.945],
      zoom: 13,
    });

    return () => {
      map.remove();
    };
  }, []);

  useEffect(() => {
    document.title = t(locale, 'app.title');
  }, [locale]);

  return (
    <main>
      <h1>{t(locale, 'app.title')}</h1>
      <label htmlFor="language-select">{t(locale, 'app.language')}</label>
      <select
        id="language-select"
        value={locale}
        onChange={(event) => setLocale((event.target as HTMLSelectElement).value as Locale)}
      >
        {locales.map((option) => (
          <option key={option} value={option}>
            {t(locale, `app.language.${option}`)}
          </option>
        ))}
      </select>
      <div ref={mapElementRef} id="map" aria-label={t(locale, 'app.mapLabel')} role="region" />
    </main>
  );
}
