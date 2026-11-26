import type { Settings } from './settings';

export type ElementId = 'clock' | 'date' | 'greeting' | 'search' | 'links' | 'status' | 'scenebar' | 'gear';

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/** Every piece of on-page UI the user can remove or change. */
export const ELEMENTS: Array<{ id: ElementId; label: string; key: BoolKey; selector: string }> = [
  { id: 'clock', label: 'Clock', key: 'showClock', selector: '#clock' },
  { id: 'date', label: 'Date', key: 'showDate', selector: '#date' },
  { id: 'greeting', label: 'Greeting', key: 'showGreeting', selector: '#greeting' },
  { id: 'search', label: 'Search box', key: 'showSearch', selector: '#search' },
  { id: 'links', label: 'Shortcuts', key: 'showLinks', selector: '#links' },
  { id: 'status', label: 'Weather pill', key: 'showStatus', selector: '#status-pill' },
  { id: 'scenebar', label: 'Scene bar', key: 'showSceneBar', selector: '#scenebar' },
  { id: 'gear', label: 'Settings button', key: 'showGear', selector: '#gear' },
];
