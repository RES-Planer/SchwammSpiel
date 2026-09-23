import type { JSX } from 'preact';

import { type Locale, t } from './i18n';
import { assumptionsForMeasure, type LandUseChangeEvaluation } from './measureToScenario';
import type { MeasureState } from './scenarioState';

function formatValue(formatter: Intl.NumberFormat, value: number, unit?: string): string {
  if (!Number.isFinite(value)) {
    return '–';
  }
  return unit ? `${formatter.format(value)} ${unit}` : formatter.format(value);
}

export function MeasureCard({
  locale,
  numberFormatter,
  measure,
  summary,
  landUseEvaluation,
  onToggle,
  onEdit,
  onDelete,
}: {
  locale: Locale;
  numberFormatter: Intl.NumberFormat;
  measure: MeasureState;
  summary: {
    areaHa: number;
    lengthM: number;
    volumeM3: number;
    excavationM3: number;
    warnings: string[];
    cutM3: number | null;
    fillM3: number | null;
    massBalanceM3: number | null;
    capturedAreaShare: number | null;
  };
  landUseEvaluation: LandUseChangeEvaluation | null;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const assumptionKeys = assumptionsForMeasure(measure);
  const deltaCn =
    landUseEvaluation?.before?.cn !== undefined
      ? landUseEvaluation.result.cn - landUseEvaluation.before.cn
      : null;

  return (
    <li className="measure-card">
      <label className="layer-toggle">
        <input type="checkbox" checked={measure.enabled} onChange={onToggle} />
        <span>{t(locale, `measure.tool.${measure.kind}`)}</span>
      </label>
      <div className="measure-card-actions">
        <button type="button" onClick={onEdit}>
          {t(locale, 'measure.card.edit')}
        </button>
        <button type="button" onClick={onDelete}>
          {t(locale, 'measure.card.delete')}
        </button>
      </div>
      <dl className="measure-metrics">
        <div>
          <dt>{t(locale, 'measure.metric.areaHa')}</dt>
          <dd>{formatValue(numberFormatter, summary.areaHa, 'ha')}</dd>
        </div>
        <div>
          <dt>{t(locale, 'measure.metric.lengthM')}</dt>
          <dd>{formatValue(numberFormatter, summary.lengthM, 'm')}</dd>
        </div>
        <div>
          <dt>{t(locale, 'measure.metric.volumeM3')}</dt>
          <dd>{formatValue(numberFormatter, summary.volumeM3, 'm³')}</dd>
        </div>
        <div>
          <dt>{t(locale, 'measure.metric.excavationM3')}</dt>
          <dd>{formatValue(numberFormatter, summary.excavationM3, 'm³')}</dd>
        </div>
      </dl>
      {summary.cutM3 !== null ||
      summary.fillM3 !== null ||
      summary.massBalanceM3 !== null ||
      summary.capturedAreaShare !== null ? (
        <dl className="measure-metrics">
          <div>
            <dt>{t(locale, 'measure.metric.cutM3')}</dt>
            <dd>{summary.cutM3 === null ? '–' : formatValue(numberFormatter, summary.cutM3, 'm³')}</dd>
          </div>
          <div>
            <dt>{t(locale, 'measure.metric.fillM3')}</dt>
            <dd>{summary.fillM3 === null ? '–' : formatValue(numberFormatter, summary.fillM3, 'm³')}</dd>
          </div>
          <div>
            <dt>{t(locale, 'measure.metric.massBalanceM3')}</dt>
            <dd>
              {summary.massBalanceM3 === null ? '–' : formatValue(numberFormatter, summary.massBalanceM3, 'm³')}
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'measure.metric.capturedAreaPct')}</dt>
            <dd>
              {summary.capturedAreaShare === null
                ? '–'
                : formatValue(numberFormatter, summary.capturedAreaShare * 100, '%')}
            </dd>
          </div>
        </dl>
      ) : null}
      {landUseEvaluation ? (
        <dl className="measure-metrics">
          <div>
            <dt>{t(locale, 'measure.metric.cnAfter')}</dt>
            <dd>{formatValue(numberFormatter, landUseEvaluation.result.cn)}</dd>
          </div>
          <div>
            <dt>{t(locale, 'measure.metric.cnBefore')}</dt>
            <dd>
              {landUseEvaluation.before ? formatValue(numberFormatter, landUseEvaluation.before.cn) : '–'}
            </dd>
          </div>
          <div>
            <dt>{t(locale, 'measure.metric.cnDelta')}</dt>
            <dd>{deltaCn === null ? '–' : formatValue(numberFormatter, deltaCn)}</dd>
          </div>
        </dl>
      ) : null}
      {landUseEvaluation ? (
        <details>
          <summary>{t(locale, 'measure.card.cnSteps')}</summary>
          <ol className="warning-list">
            {landUseEvaluation.result.steps.map((step, index) => (
              <li key={`${step.step}-${index}`}>
                {step.step}: {formatValue(numberFormatter, step.beforeCn)} →{' '}
                {formatValue(numberFormatter, step.afterCn)}
                {step.formula ? ` (${step.formula})` : ''}
                {step.note ? ` — ${step.note}` : ''}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {summary.warnings.length > 0 || (landUseEvaluation?.result.warnings.length ?? 0) > 0 || assumptionKeys.length > 0 ? (
        <ul className="warning-list">
          {summary.warnings.map((warning) => (
            <li key={warning}>{t(locale, `measure.warning.${warning}`)}</li>
          ))}
          {(landUseEvaluation?.result.warnings ?? []).map((warning) => (
            <li key={`${warning.step}-${warning.code}`}>{warning.message}</li>
          ))}
          {assumptionKeys.map((assumptionKey) => (
            <li key={assumptionKey}>
              {t(locale, 'measure.assumption.label')}: {t(locale, assumptionKey)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
