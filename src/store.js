// Saved spots and settings, kept on the device (localStorage).
const SPOTS = 'sunspy.spots';
const STATE = 'sunspy.state';

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

export const loadSpots = () => read(SPOTS, []);
export const saveSpots = (s) => write(SPOTS, s);

export function addSpot(spot) {
  const all = loadSpots();
  const s = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: Date.now(), ...spot };
  all.unshift(s);
  saveSpots(all);
  return s;
}
export function updateSpot(id, patch) {
  const all = loadSpots().map((s) => (s.id === id ? { ...s, ...patch } : s));
  saveSpots(all);
}
export function deleteSpot(id) {
  saveSpots(loadSpots().filter((s) => s.id !== id));
}

export const loadState = () => read(STATE, {});
export const saveState = (s) => write(STATE, s);
