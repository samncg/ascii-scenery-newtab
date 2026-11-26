import { AuroraScene } from './aurora';
import { ButterfliesScene } from './butterflies';
import { CabinScene } from './cabin';
import { CatScene } from './cat';
import { ClearingScene } from './clearing';
import { JellyfishScene } from './jellyfish';
import { KoiScene } from './koi';
import { MantasScene } from './mantas';
import { SFScene } from './sf';
import { SilhouetteScene } from './silhouette';
import { TokyoScene } from './tokyo';
import type { Scene, SceneId } from './types';

export interface SceneInfo {
  id: SceneId;
  name: string;
  short: string;
  group: 'Scenery' | 'Animals';
  glyph: string;
  make: () => Scene;
}

export const SCENES: SceneInfo[] = [
  { id: 'tokyo', name: 'Tokyo Balcony', short: 'Tokyo', group: 'Scenery', glyph: '[#]', make: () => new TokyoScene() },
  { id: 'cabin', name: 'Forest Cabin', short: 'Cabin', group: 'Scenery', glyph: '/^\\', make: () => new CabinScene() },
  { id: 'sf', name: 'San Francisco', short: 'Golden Gate', group: 'Scenery', glyph: '|=|', make: () => new SFScene() },
  { id: 'silhouette', name: 'Forest Silhouette', short: 'Silhouette', group: 'Scenery', glyph: '^^^', make: () => new SilhouetteScene() },
  { id: 'aurora', name: 'Aurora', short: 'Aurora', group: 'Scenery', glyph: '|!|', make: () => new AuroraScene() },
  { id: 'koi', name: 'Koi', short: 'Koi', group: 'Animals', glyph: '><>', make: () => new KoiScene() },
  { id: 'butterflies', name: 'Butterflies', short: 'Butterflies', group: 'Animals', glyph: '}i{', make: () => new ButterfliesScene() },
  { id: 'mantas', name: 'Manta Rays', short: 'Mantas', group: 'Animals', glyph: '<V>', make: () => new MantasScene() },
  { id: 'jellyfish', name: 'Jellyfish', short: 'Jellyfish', group: 'Animals', glyph: '(:)', make: () => new JellyfishScene() },
  { id: 'cat', name: 'Window Cat', short: 'Cat', group: 'Animals', glyph: '=^.^=', make: () => new CatScene() },
  { id: 'clearing', name: 'Fox & Owl', short: 'Fox & Owl', group: 'Animals', glyph: '(o,o)', make: () => new ClearingScene() },
];

export function makeScene(id: SceneId): Scene {
  return (SCENES.find((s) => s.id === id) ?? SCENES[0]).make();
}
