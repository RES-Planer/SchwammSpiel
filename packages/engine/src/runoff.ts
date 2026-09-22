export function storageMmFromCn(cn: number): number {
  return 25400 / cn - 254;
}

export function initialAbstractionMm(cn: number, iaRatio: number): number {
  return iaRatio * storageMmFromCn(cn);
}

export function effectiveRainMm(pCumMm: number, cn: number, iaRatio: number): number {
  const sMm = storageMmFromCn(cn);
  const iaMm = iaRatio * sMm;
  if (pCumMm <= iaMm) {
    return 0;
  }
  return ((pCumMm - iaMm) ** 2) / (pCumMm - iaMm + sMm);
}
