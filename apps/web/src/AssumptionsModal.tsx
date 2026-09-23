import { assumptions } from '@schwammspiel/engine';

import type { Locale } from './i18n';
import { t } from './i18n';
import { SPEC_SECTION_11_LINES } from './scenarioResults';

type Props = {
  locale: Locale;
  open: boolean;
  onClose: () => void;
};

export function AssumptionsModal({ locale, open, onClose }: Props) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assumptions-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="assumptions-title">{t(locale, 'result.assumptions')}</h2>
          <button type="button" onClick={onClose}>
            {t(locale, 'common.close')}
          </button>
        </div>

        <section className="assumptions-section">
          <h3>{t(locale, 'result.assumptions.specSection')}</h3>
          <ul className="limits-list">
            {SPEC_SECTION_11_LINES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="assumptions-section">
          <h3>{t(locale, 'result.assumptions.engine')}</h3>
          <ul className="assumption-list">
            {assumptions.map((assumption) => (
              <li key={assumption.id} className="assumption-card">
                <div className="assumption-headline">
                  <strong>
                    {assumption.id}: {assumption.title}
                  </strong>
                  <span className={`assumption-status assumption-status-${assumption.status}`}>
                    {assumption.status}
                  </span>
                </div>
                <p>{assumption.value}</p>
                <p className="assumption-source">{assumption.source}</p>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </div>
  );
}
