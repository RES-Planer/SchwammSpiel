import { hydrologyTables, type CurveNumberLandUse, type Month, type SoilGroup } from '@schwammspiel/engine';
import type { JSX } from 'preact';

import { type Locale, t } from './i18n';
import type { CnZoneDefaults } from './cnZones';
import { supportsMulchAndTillage } from './measureToScenario';
import type { MeasureKind, MeasureState } from './scenarioState';

const monthlyLandUses = Object.keys(hydrologyTables.cn_monthly_soil_group_C) as CurveNumberLandUse[];
const lowSeasonalityLandUses = Object.keys(
  hydrologyTables.cn_low_seasonality_by_soil_group,
) as CurveNumberLandUse[];
const monthOrder = Object.keys(hydrologyTables.cn_monthly_soil_group_C.Mais) as Month[];
const soilGroups: SoilGroup[] = ['A', 'B', 'C', 'D'];

function landUseI18nKey(landUse: string): string {
  return `measure.landUse.${landUse}`;
}

function landUseLabel(locale: Locale, landUse: string): string {
  const key = landUseI18nKey(landUse);
  const localized = t(locale, key);
  return localized === key ? landUse : localized;
}

export function getLandUseChangeFormConfig(landUse: string): {
  isMonthly: boolean;
  showMulchAndTillage: boolean;
} {
  return {
    isMonthly: monthlyLandUses.includes(landUse as CurveNumberLandUse),
    showMulchAndTillage: supportsMulchAndTillage(landUse),
  };
}

export function defaultParams(
  kind: MeasureKind,
  cnZoneDefaults: CnZoneDefaults | null = null,
): Record<string, number | string> {
  switch (kind) {
    case 'landUseChange': {
      const defaultLandUse = cnZoneDefaults?.landUse ?? ('Grünland' as CurveNumberLandUse);
      const config = getLandUseChangeFormConfig(defaultLandUse);
      return {
        landUse: defaultLandUse,
        soilGroup: cnZoneDefaults?.soilGroup ?? 'C',
        month: config.isMonthly ? 'Mar' : 'low-seasonality',
        mulchDirectSeed: 'no',
        mulchCoverFraction: 0.3,
        tillageDirection: 'downslope',
        sourceLandUse: cnZoneDefaults?.landUse ?? defaultLandUse,
        sourceSoilGroup: cnZoneDefaults?.soilGroup ?? 'C',
        sourceCn: cnZoneDefaults?.cn ?? '',
      };
    }
    case 'storageWithPipe':
      return {
        form: 'prism',
        depthM: 1.2,
        pipeDnMm: 300,
        pipeLengthM: 12,
        inflowDtH: 0.25,
        inflowSeriesM3s: '',
        targetQOutM3s: 0.18,
      };
    case 'forestMulches':
      return {
        count: 3,
        volumeEachM3: 8,
        location: 'mid',
      };
    case 'swale':
      return {
        bottomWidthM: 0.5,
        depthM: 0.5,
        sideSlopeM: 2,
        landCoverK: 12,
        elevationProfile: '',
      };
    case 'stonefield':
      return {
        spacingM: 2,
        holeDiameterM: 0.8,
        holeDepthM: 1,
        porosity: 0.35,
        qInMaxM3s: 0.3,
        slope: 0.03,
        kStone: 35,
        d50M: 0.08,
      };
    case 'flowPathChange':
      return {
        segmentType: 'hollow',
        roughnessK: 25,
      };
  }
}

export function MeasureForm({
  locale,
  measure,
  updateMeasure,
  applyStorageSuggestion,
}: {
  locale: Locale;
  measure: MeasureState;
  updateMeasure: (id: string, updater: (measure: MeasureState) => MeasureState) => void;
  applyStorageSuggestion: () => void;
}): JSX.Element {
  const setParam = (key: string, value: string | number) => {
    updateMeasure(measure.id, (current) => ({
      ...current,
      params: {
        ...current.params,
        [key]: value,
      },
    }));
  };

  switch (measure.kind) {
    case 'landUseChange': {
      const selectedLandUse = String(measure.params.landUse ?? 'Grünland');
      const config = getLandUseChangeFormConfig(selectedLandUse);
      const sourceCn =
        typeof measure.params.sourceCn === 'number'
          ? measure.params.sourceCn
          : typeof measure.params.sourceCn === 'string'
            ? Number(measure.params.sourceCn)
            : Number.NaN;
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.landUse')}
            <select
              value={selectedLandUse}
              onChange={(event) => {
                const landUse = (event.target as HTMLSelectElement).value;
                const nextConfig = getLandUseChangeFormConfig(landUse);
                setParam('landUse', landUse);
                setParam('month', nextConfig.isMonthly ? 'Mar' : 'low-seasonality');
                if (!nextConfig.showMulchAndTillage) {
                  setParam('mulchDirectSeed', 'no');
                  setParam('tillageDirection', 'downslope');
                }
              }}
            >
              <optgroup label={t(locale, 'measure.param.landUse.monthly')}>
                {monthlyLandUses.map((landUse) => (
                  <option key={landUse} value={landUse}>
                    {landUseLabel(locale, landUse)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t(locale, 'measure.param.landUse.lowSeasonality')}>
                {lowSeasonalityLandUses.map((landUse) => (
                  <option key={landUse} value={landUse}>
                    {landUseLabel(locale, landUse)}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            {t(locale, 'measure.param.soilGroup')}
            <select
              value={String(measure.params.soilGroup ?? 'C')}
              onChange={(event) => setParam('soilGroup', (event.target as HTMLSelectElement).value)}
            >
              {soilGroups.map((soilGroup) => (
                <option key={soilGroup} value={soilGroup}>
                  {soilGroup}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(locale, 'measure.param.month')}
            <select
              value={String(measure.params.month ?? (config.isMonthly ? 'Mar' : 'low-seasonality'))}
              onChange={(event) => setParam('month', (event.target as HTMLSelectElement).value)}
              disabled={!config.isMonthly}
            >
              {config.isMonthly ? (
                monthOrder.map((month) => (
                  <option key={month} value={month}>
                    {t(locale, `measure.month.${month}`)}
                  </option>
                ))
              ) : (
                <option value="low-seasonality">{t(locale, 'measure.param.month.lowSeasonality')}</option>
              )}
            </select>
          </label>
          {config.showMulchAndTillage ? (
            <>
              <label>
                {t(locale, 'measure.param.mulchDirectSeed')}
                <select
                  value={String(measure.params.mulchDirectSeed ?? 'no')}
                  onChange={(event) => setParam('mulchDirectSeed', (event.target as HTMLSelectElement).value)}
                >
                  <option value="yes">{t(locale, 'common.yes')}</option>
                  <option value="no">{t(locale, 'common.no')}</option>
                </select>
              </label>
              <label>
                {t(locale, 'measure.param.mulchCoverFraction')}
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={String(measure.params.mulchCoverFraction ?? 0.3)}
                  onInput={(event) =>
                    setParam('mulchCoverFraction', (event.target as HTMLInputElement).value)
                  }
                  disabled={measure.params.mulchDirectSeed !== 'yes'}
                />
              </label>
              <label>
                {t(locale, 'measure.param.tillageDirection')}
                <select
                  value={String(measure.params.tillageDirection ?? 'downslope')}
                  onChange={(event) =>
                    setParam('tillageDirection', (event.target as HTMLSelectElement).value)
                  }
                >
                  <option value="contour-parallel">{t(locale, 'measure.param.tillageDirection.contour')}</option>
                  <option value="downslope">{t(locale, 'measure.param.tillageDirection.downslope')}</option>
                  <option value="terraced">{t(locale, 'measure.param.tillageDirection.terraced')}</option>
                </select>
              </label>
            </>
          ) : null}
          <p className="hint-text">
            {t(locale, 'measure.param.beforeState')}:{' '}
            {[
              typeof measure.params.sourceLandUse === 'string'
                ? `${t(locale, 'measure.param.landUse')}: ${landUseLabel(locale, String(measure.params.sourceLandUse))}`
                : null,
              measure.params.sourceSoilGroup ? `${t(locale, 'measure.param.soilGroup')}: ${measure.params.sourceSoilGroup}` : null,
              Number.isFinite(sourceCn) ? `${t(locale, 'map.details.cn')}: ${sourceCn}` : null,
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
        </div>
      );
    }
    case 'storageWithPipe':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.form')}
            <select
              value={String(measure.params.form ?? 'prism')}
              onChange={(event) => setParam('form', (event.target as HTMLSelectElement).value)}
            >
              <option value="prism">{t(locale, 'measure.param.form.prism')}</option>
              <option value="hollow">{t(locale, 'measure.param.form.hollow')}</option>
            </select>
          </label>
          <label>
            {t(locale, 'measure.param.depthM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.depthM ?? 1.2)}
              onInput={(event) => setParam('depthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.pipeDnMm')}
            <input
              type="number"
              min={50}
              step={10}
              value={String(measure.params.pipeDnMm ?? 300)}
              onInput={(event) => setParam('pipeDnMm', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.pipeLengthM')}
            <input
              type="number"
              min={1}
              step={1}
              value={String(measure.params.pipeLengthM ?? 12)}
              onInput={(event) => setParam('pipeLengthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.targetQOutM3s')}
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={String(measure.params.targetQOutM3s ?? 0.18)}
              onInput={(event) => setParam('targetQOutM3s', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.inflowDtH')}
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={String(measure.params.inflowDtH ?? 0.25)}
              onInput={(event) => setParam('inflowDtH', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.inflowSeriesM3s')}
            <input
              value={String(measure.params.inflowSeriesM3s ?? '')}
              onInput={(event) => setParam('inflowSeriesM3s', (event.target as HTMLInputElement).value)}
              placeholder={t(locale, 'measure.param.inflowSeriesM3s.placeholder')}
            />
          </label>
          <button type="button" onClick={applyStorageSuggestion}>
            {t(locale, 'measure.param.suggestSize')}
          </button>
        </div>
      );
    case 'forestMulches':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.count')}
            <input
              type="number"
              min={1}
              step={1}
              value={String(measure.params.count ?? 3)}
              onInput={(event) => setParam('count', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.volumeEachM3')}
            <input
              type="number"
              min={1}
              step={1}
              value={String(measure.params.volumeEachM3 ?? 8)}
              onInput={(event) => setParam('volumeEachM3', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.location')}
            <select
              value={String(measure.params.location ?? 'mid')}
              onChange={(event) => setParam('location', (event.target as HTMLSelectElement).value)}
            >
              <option value="top">{t(locale, 'measure.param.location.top')}</option>
              <option value="mid">{t(locale, 'measure.param.location.mid')}</option>
              <option value="low">{t(locale, 'measure.param.location.low')}</option>
            </select>
          </label>
        </div>
      );
    case 'swale':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.bottomWidthM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.bottomWidthM ?? 0.5)}
              onInput={(event) => setParam('bottomWidthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.depthM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.depthM ?? 0.5)}
              onInput={(event) => setParam('depthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.sideSlopeM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.sideSlopeM ?? 2)}
              onInput={(event) => setParam('sideSlopeM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.elevationProfile')}
            <input
              value={String(measure.params.elevationProfile ?? '')}
              onInput={(event) => setParam('elevationProfile', (event.target as HTMLInputElement).value)}
              placeholder={t(locale, 'measure.param.elevationProfile.placeholder')}
            />
          </label>
        </div>
      );
    case 'stonefield':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.spacingM')}
            <input
              type="number"
              min={0.2}
              step={0.1}
              value={String(measure.params.spacingM ?? 2)}
              onInput={(event) => setParam('spacingM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.holeDiameterM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.holeDiameterM ?? 0.8)}
              onInput={(event) => setParam('holeDiameterM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.holeDepthM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.holeDepthM ?? 1)}
              onInput={(event) => setParam('holeDepthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.porosity')}
            <input
              type="number"
              min={0.1}
              max={1}
              step={0.05}
              value={String(measure.params.porosity ?? 0.35)}
              onInput={(event) => setParam('porosity', (event.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      );
    case 'flowPathChange':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.segmentType')}
            <input
              value={String(measure.params.segmentType ?? 'hollow')}
              onInput={(event) => setParam('segmentType', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.roughnessK')}
            <input
              type="number"
              min={1}
              step={1}
              value={String(measure.params.roughnessK ?? 25)}
              onInput={(event) => setParam('roughnessK', (event.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      );
  }
}
