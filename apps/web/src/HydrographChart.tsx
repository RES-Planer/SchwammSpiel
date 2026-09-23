import type { ScenarioHydrograph } from '@schwammspiel/engine';
import uPlot from 'uplot';
import { useEffect, useRef } from 'preact/hooks';

import 'uplot/dist/uPlot.min.css';

type Props = {
  locale: string;
  labels: {
    rainfallAxis: string;
    timeAxis: string;
    dischargeAxis: string;
    before: string;
    after: string;
    rainfallAria: string;
    hydrographAria: string;
  };
  rainfall: { timeH: number[]; intensityMmH: number[] };
  before: ScenarioHydrograph;
  after: ScenarioHydrograph;
};

function interpolateSeries(hydrograph: ScenarioHydrograph, timeH: number): number {
  if (timeH < 0) {
    return 0;
  }
  const rawIndex = timeH / hydrograph.dtH;
  const lo = Math.floor(rawIndex);
  const hi = lo + 1;
  const loValue = hydrograph.qM3s[lo] ?? 0;
  const hiValue = hydrograph.qM3s[hi] ?? loValue;
  return loValue + (hiValue - loValue) * (rawIndex - lo);
}

function buildCommonTimeAxis(before: ScenarioHydrograph, after: ScenarioHydrograph): number[] {
  const dtH = Math.min(before.dtH, after.dtH);
  const maxTimeH = Math.max(
    Math.max(0, before.qM3s.length - 1) * before.dtH,
    Math.max(0, after.qM3s.length - 1) * after.dtH,
  );
  return Array.from({ length: Math.ceil(maxTimeH / dtH) + 1 }, (_, index) => index * dtH);
}

function alignRainfallToTimes(timesH: number[], rainfall: Props['rainfall']): number[] {
  return timesH.map((timeH) => {
    const index = rainfall.timeH.findIndex((entry, position) => {
      const next = rainfall.timeH[position + 1] ?? Number.POSITIVE_INFINITY;
      return timeH >= entry && timeH < next;
    });
    return index >= 0 ? -(rainfall.intensityMmH[index] ?? 0) : 0;
  });
}

export function HydrographChart({ locale, labels, rainfall, before, after }: Props) {
  const rainHostRef = useRef<HTMLDivElement | null>(null);
  const hydrographHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const rainHost = rainHostRef.current;
    const hydrographHost = hydrographHostRef.current;
    if (!rainHost || !hydrographHost) {
      return;
    }

    const timeH = buildCommonTimeAxis(before, after);
    const beforeSeries = timeH.map((timeValue) => interpolateSeries(before, timeValue));
    const afterSeries = timeH.map((timeValue) => interpolateSeries(after, timeValue));
    const rainfallSeries = alignRainfallToTimes(timeH, rainfall);
    const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const width = Math.max(280, rainHost.clientWidth || hydrographHost.clientWidth || 280);
    const rainPaths = uPlot.paths.bars ? uPlot.paths.bars({ size: [0.8, 80] }) : undefined;

    const rainPlot = new uPlot(
      {
        width,
        height: 140,
        legend: { show: false },
        scales: {
          x: { time: false },
          y: { range: [null, 0] },
        },
        axes: [
          { show: false },
          {
            values: (_, values) => values.map((value) => formatter.format(Math.abs(value))),
            label: labels.rainfallAxis,
          },
        ],
        series: [
          {},
          {
            stroke: '#2563eb',
            fill: '#93c5fd',
            paths: rainPaths,
          },
        ],
      },
      [timeH, rainfallSeries],
      rainHost,
    );

    const hydrographPlot = new uPlot(
      {
        width,
        height: 260,
        legend: { show: true },
        scales: {
          x: { time: false },
        },
        axes: [
          {
            label: labels.timeAxis,
            values: (_, values) => values.map((value) => formatter.format(value)),
          },
          {
            label: labels.dischargeAxis,
            values: (_, values) => values.map((value) => formatter.format(value)),
          },
        ],
        series: [
          {},
          {
            label: labels.before,
            stroke: '#334155',
            width: 2,
          },
          {
            label: labels.after,
            stroke: '#0f766e',
            width: 2,
          },
        ],
      },
      [timeH, beforeSeries, afterSeries],
      hydrographHost,
    );

    return () => {
      rainPlot.destroy();
      hydrographPlot.destroy();
    };
  }, [after, before, locale, rainfall]);

  return (
    <div className="hydrograph-chart-stack">
      <div ref={rainHostRef} className="chart-host" role="img" aria-label={labels.rainfallAria} />
      <div
        ref={hydrographHostRef}
        className="chart-host"
        role="img"
        aria-label={labels.hydrographAria}
      />
    </div>
  );
}
