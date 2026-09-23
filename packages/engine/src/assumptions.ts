export type AssumptionStatus = 'thesis' | 'derived' | 'expert-estimate';

export type Assumption = {
  id: string;
  title: string;
  value: string;
  status: AssumptionStatus;
  source: string;
};

export type HydrologyConstant = {
  id: string;
  value: number;
  status: AssumptionStatus;
  source: string;
};

export const ASSUMPTION_A1: Assumption = {
  id: 'A1',
  title: 'Regenform mittenbetont',
  value: '(0;0), (0.3;0.2), (0.5;0.7), (1;1)',
  status: 'derived',
  source: 'reference/nrcs_reference.py:42-47; docs/SPEC_hydrology.md Abschnitt 3',
};

export const ASSUMPTION_A2: Assumption = {
  id: 'A2',
  title: 'Gamma-Einheitsganglinie',
  value: 'q/qp = (t/Tp)^m * exp(m*(1 - t/Tp)) mit m aus 645.33/PRF = e^m*Gamma(m+1)/m^(m+1)',
  status: 'derived',
  source: 'reference/nrcs_reference.py:28-39; docs/SPEC_hydrology.md Abschnitt 4',
};

export const ASSUMPTION_A3: Assumption = {
  id: 'A3',
  title: 'Rohrdrossel',
  value: 'Q = A_Rohr * sqrt(2*g*h / (2.5 + 0.02 * L/d))',
  status: 'derived',
  source: 'reference/nrcs_reference.py:97-102; docs/SPEC_hydrology.md Abschnitt 6',
};

export const ASSUMPTION_A4: Assumption = {
  id: 'A4',
  title: 'Speicherformen Fläche/Mulde',
  value:
    'Fläche: V=A*h; Mulde: Vmax=2/3*L*B*hMax und V(h)=Vmax*(h/hMax)^1.5',
  status: 'derived',
  source: 'reference/nrcs_reference.py:108-112; docs/SPEC_hydrology.md Abschnitt 6',
};

export const ASSUMPTION_A5: Assumption = {
  id: 'A5',
  title: 'Basisabfluss additiv',
  value: 'Basisabfluss = Mq * A wird konstant addiert',
  status: 'derived',
  source: 'reference/nrcs_reference.py:18-19,91-93; docs/SPEC_hydrology.md Abschnitt 4',
};

export const ASSUMPTION_A6: Assumption = {
  id: 'A6',
  title: 'Abflusslose Rückhalteelemente im physical-Modus',
  value:
    'Elementzufluss q_e = a_e*(Q(t+t_e)-Q_Basis), vollständiger Rückhalt bis V_e voll; optionale Versickerung q_inf = kf*A_inf',
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 7',
};

export const ASSUMPTION_A7: Assumption = {
  id: 'A7',
  title: 'Swale bremst l_sheet',
  value: 'Nach Schnittpunkt werden standardmäßig 30 m Fließweg als sheet modelliert',
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 8',
};

export const ASSUMPTION_A8: Assumption = {
  id: 'A8',
  title: 'Steinfeld-Standardwerte',
  value: 's=2 m, d=0.4 m, z=0.8 m, n=0.30, d50=0.08 m, k_stone=8',
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 9',
};

export const NRCS_DELTA_D_FROM_TC: HydrologyConstant = {
  id: 'C1',
  value: 0.133,
  status: 'thesis',
  source: 'reference/nrcs_reference.py:68; docs/SPEC_hydrology.md Abschnitt 4',
};

export const NRCS_TP_FROM_DELTA_D: HydrologyConstant = {
  id: 'C2',
  value: 0.5,
  status: 'thesis',
  source: 'reference/nrcs_reference.py:69; docs/SPEC_hydrology.md Abschnitt 4',
};

export const NRCS_TP_FROM_TC: HydrologyConstant = {
  id: 'C3',
  value: 0.6,
  status: 'thesis',
  source: 'reference/nrcs_reference.py:69; docs/SPEC_hydrology.md Abschnitt 4',
};

export const NRCS_PRF_REFERENCE_RATIO: HydrologyConstant = {
  id: 'C4',
  value: 645.33,
  status: 'derived',
  source: 'reference/nrcs_reference.py:30,76; docs/SPEC_hydrology.md Abschnitt 4',
};

export const NRCS_UH_CUTOFF: HydrologyConstant = {
  id: 'C5',
  value: 0.001,
  status: 'derived',
  source: 'reference/nrcs_reference.py:66,83; docs/SPEC_hydrology.md Abschnitt 4',
};

export const SWALE_L_SHEET_DEFAULT_M: HydrologyConstant = {
  id: 'C6',
  value: 30,
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 8 (ANNAHME A7)',
};

export const STONEFIELD_H_OVERLOAD_LIMIT_M: HydrologyConstant = {
  id: 'C7',
  value: 0.03,
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 9',
};

export const STONEFIELD_K_DEFAULT: HydrologyConstant = {
  id: 'C8',
  value: 8,
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 9 (ANNAHME A8)',
};

export const STONEFIELD_K_OVERLOADED: HydrologyConstant = {
  id: 'C9',
  value: 25,
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 9',
};

export const STONEFIELD_SPACING_DEFAULT_M: HydrologyConstant = {
  id: 'C10',
  value: 2,
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 9 (ANNAHME A8)',
};

export const STONEFIELD_HOLE_DIAMETER_DEFAULT_M: HydrologyConstant = {
  id: 'C11',
  value: 0.4,
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 9 (ANNAHME A8)',
};

export const STONEFIELD_HOLE_DEPTH_DEFAULT_M: HydrologyConstant = {
  id: 'C12',
  value: 0.8,
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 9 (ANNAHME A8)',
};

export const STONEFIELD_POROSITY_DEFAULT: HydrologyConstant = {
  id: 'C13',
  value: 0.3,
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 9 (ANNAHME A8)',
};

export const STONEFIELD_D50_DEFAULT_M: HydrologyConstant = {
  id: 'C14',
  value: 0.08,
  status: 'expert-estimate',
  source: 'docs/SPEC_hydrology.md Abschnitt 9 (ANNAHME A8)',
};

export const SWALE_CONTOUR_DZ_WARNING_M: HydrologyConstant = {
  id: 'C15',
  value: 0.3,
  status: 'thesis',
  source: 'docs/SPEC_hydrology.md Abschnitt 8',
};

export const FOREST_MULCH_DELAY_TOP_H: HydrologyConstant = {
  id: 'C16',
  value: 0.15,
  status: 'expert-estimate',
  source: 'apps/web/src/app.tsx TODO(DATA): Waldmulden Fließzeiten',
};

export const FOREST_MULCH_DELAY_MID_H: HydrologyConstant = {
  id: 'C17',
  value: 0.4,
  status: 'expert-estimate',
  source: 'apps/web/src/app.tsx TODO(DATA): Waldmulden Fließzeiten',
};

export const FOREST_MULCH_DELAY_LOW_H: HydrologyConstant = {
  id: 'C18',
  value: 0.75,
  status: 'expert-estimate',
  source: 'apps/web/src/app.tsx TODO(DATA): Waldmulden Fließzeiten',
};

export const FLOWPATH_CHANGE_SLOPE_DEFAULT: HydrologyConstant = {
  id: 'C19',
  value: 0.03,
  status: 'expert-estimate',
  source: 'apps/web/src/app.tsx TODO(DATA): Gefälle geänderter Fließwegabschnitt',
};

export const FLOWPATH_LOCATION_SHARE_DEFAULT: HydrologyConstant = {
  id: 'C20',
  value: 0.35,
  status: 'expert-estimate',
  source: 'apps/web/src/app.tsx TODO(DATA): Lage am Fließweg',
};

export const assumptions = [
  ASSUMPTION_A1,
  ASSUMPTION_A2,
  ASSUMPTION_A3,
  ASSUMPTION_A4,
  ASSUMPTION_A5,
  ASSUMPTION_A6,
  ASSUMPTION_A7,
  ASSUMPTION_A8,
] as const;
