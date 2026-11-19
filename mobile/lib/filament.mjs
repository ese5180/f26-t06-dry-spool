import { ApiError } from './http.mjs';

export const materials = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'PVA', 'PA'];

export function filamentProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Enter a filament material and color.');
  }
  const text = (field, limit, required = false) => {
    const raw = value[field];
    if (raw !== undefined && typeof raw !== 'string') throw new ApiError(400, 'Invalid ' + field + '.');
    const result = (raw || '').trim();
    if ((required && !result) || result.length > limit || /[\u0000-\u001f\u007f]/.test(result)) {
      throw new ApiError(400, 'Check the filament ' + field + '.');
    }
    return result;
  };
  const material = text('material', 40, true);
  const color = text('color', 80, true);
  const brand = text('brand', 80);
  const colorHex = text('colorHex', 7);
  if (colorHex && !/^#[\da-f]{6}$/i.test(colorHex)) {
    throw new ApiError(400, 'Choose a valid color.');
  }
  return {material, color, colorHex: colorHex.toUpperCase(), brand};
}

export function savedFilament(value) {
  if (value?.source !== 'manual' || value.version !== 1 || !Number.isSafeInteger(value.updatedMs) || value.updatedMs <= 0) return null;
  try {
    return {...filamentProfile(value), source: 'manual', version: 1, updatedMs: value.updatedMs};
  } catch {
    return null;
  }
}
