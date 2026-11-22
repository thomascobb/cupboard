// localStorage that never throws (private mode, storage disabled, etc.).
const PREFIX = 'cupboard:';

export function lget(k: string): string | null {
  try {
    return localStorage.getItem(PREFIX + k);
  } catch {
    return null;
  }
}

export function lset(k: string, v: string | null): void {
  try {
    if (v === null || v === '') localStorage.removeItem(PREFIX + k);
    else localStorage.setItem(PREFIX + k, v);
  } catch {
    /* keep going without it */
  }
}

/** "Who's this phone?" – a per-device name for the change log. */
export const deviceName = () => lget('device') ?? '';
export const setDeviceName = (n: string) => lset('device', n);
