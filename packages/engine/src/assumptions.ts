export type AssumptionStatus = 'thesis' | 'derived' | 'expert-estimate';

export type Assumption = {
  id: string;
  title: string;
  value: string;
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

export const assumptions = [
  ASSUMPTION_A1,
  ASSUMPTION_A2,
  ASSUMPTION_A3,
  ASSUMPTION_A4,
  ASSUMPTION_A5,
] as const;
