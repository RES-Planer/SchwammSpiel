import { assumptions } from '@schwammspiel/engine';
import { useEffect, useRef } from 'preact/hooks';

import type { Locale } from './i18n';
import { t } from './i18n';

type Props = {
  locale: Locale;
  open: boolean;
  onClose: () => void;
};

export function AssumptionsModal({ locale, open, onClose }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assumptions-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="assumptions-title">{t(locale, 'result.assumptions')}</h2>
          <button ref={closeButtonRef} type="button" onClick={onClose}>
            {t(locale, 'common.close')}
          </button>
        </div>

        <section className="assumptions-section">
          <h3>{t(locale, 'result.assumptions.specSection')}</h3>
          <ul className="limits-list">
            <li>{t(locale, 'result.assumptions.limit1')}</li>
            <li>{t(locale, 'result.assumptions.limit2')}</li>
            <li>{t(locale, 'result.assumptions.limit3')}</li>
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
