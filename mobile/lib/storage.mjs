// Prusa USS Drybox recommendations are maximum in-box relative humidity,
// not drying temperatures or a promise that this box can dehumidify.
export const storageSource = 'https://help.prusa3d.com/article/prusa-uss-drybox_1014382';

const limits = {
  PLA: { max: 30, note: 'Short periods up to 40% RH are tolerated.' },
  ABS: { max: 30, note: 'Below 15% RH is preferable.' },
  ASA: { max: 30, note: 'Below 10% RH is preferable.' },
  PETG: { max: 20 },
  TPU: { max: 20, note: 'Below 15% RH is preferable.' },
  PVA: { max: 20 },
  PC: { max: 20 },
};

export function storageGuidance(material, humidity) {
  const key = typeof material === 'string' ? material.trim().toUpperCase() : '';
  const guide = limits[key];
  if (!guide) return null;
  return {
    material: key,
    ...guide,
    above: Number.isFinite(humidity) ? humidity >= guide.max : null,
  };
}
