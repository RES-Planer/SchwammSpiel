export type AssumptionStatus = 'thesis' | 'derived' | 'expert-estimate';

export type Assumption = {
  id: string;
  title: string;
  value: string;
  status: AssumptionStatus;
  source: string;
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

export const assumptions = [ASSUMPTION_A3, ASSUMPTION_A4] as const;
