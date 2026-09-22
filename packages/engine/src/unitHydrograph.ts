const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.9999999999998099,
  676.5203681218851,
  -1259.1392167224028,
  771.3234287776531,
  -176.6150291621406,
  12.507343278686905,
  -0.13857109526572012,
  9.984369578019572e-6,
  1.5056327351493116e-7,
] as const;

export function logGamma(z: number): number {
  if (!Number.isFinite(z) || z <= 0) {
    throw new Error('logGamma is only defined for z > 0');
  }

  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  const zMinus1 = z - 1;
  let x = LANCZOS_COEFFICIENTS[0];
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i += 1) {
    x += LANCZOS_COEFFICIENTS[i] / (zMinus1 + i);
  }

  const t = zMinus1 + LANCZOS_G + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (zMinus1 + 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
}

export function gammaShape(prf: number): number {
  if (!Number.isFinite(prf) || prf <= 0) {
    throw new Error('prf must be > 0');
  }

  const target = NRCS_PRF_REFERENCE_RATIO.value / prf;
  const f = (m: number) =>
    Math.exp(m + logGamma(m + 1) - (m + 1) * Math.log(m)) - target;

  let lo = 0.05;
  let hi = 30;
  let fLo = f(lo);
  const fHi = f(hi);

  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) {
    throw new Error(`gammaShape root is not bracketed for prf=${prf}`);
  }

  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (!Number.isFinite(fMid)) {
      throw new Error(`gammaShape failed to evaluate for prf=${prf}`);
    }
    if (fLo * fMid <= 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return (lo + hi) / 2;
}
import { NRCS_PRF_REFERENCE_RATIO } from './assumptions';
