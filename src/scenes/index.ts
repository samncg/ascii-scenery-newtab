import { AuroraScene } from './aurora';
import { ButterfliesScene } from './butterflies';
import { DunesScene } from './dunes';
import { FirefliesScene } from './fireflies';
import { JellyfishScene } from './jellyfish';
import { KoiScene } from './koi';
import { MantasScene } from './mantas';
import { OceanScene } from './ocean';
import { SFScene } from './sf';
import { SilhouetteScene } from './silhouette';
import { StarlingsScene } from './starlings';
import { TokyoScene } from './tokyo';
import { TurtlesScene } from './turtles';
import type { Scene, SceneId } from './types';
import { WhalesScene } from './whales';

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
  { id: 'sf', name: 'San Francisco', short: 'Golden Gate', group: 'Scenery', glyph: '|=|', make: () => new SFScene() },
  { id: 'silhouette', name: 'Forest Silhouette', short: 'Forest', group: 'Scenery', glyph: '^^^', make: () => new SilhouetteScene() },
  { id: 'aurora', name: 'Aurora', short: 'Aurora', group: 'Scenery', glyph: '|!|', make: () => new AuroraScene() },
  { id: 'dunes', name: 'Desert Dunes', short: 'Dunes', group: 'Scenery', glyph: '/~\\', make: () => new DunesScene() },
  { id: 'ocean', name: 'Ocean Shore', short: 'Ocean', group: 'Scenery', glyph: '~~~', make: () => new OceanScene() },
  { id: 'koi', name: 'Koi', short: 'Koi', group: 'Animals', glyph: '><>', make: () => new KoiScene() },
  { id: 'butterflies', name: 'Butterflies', short: 'Butterflies', group: 'Animals', glyph: '}i{', make: () => new ButterfliesScene() },
  { id: 'mantas', name: 'Manta Rays', short: 'Mantas', group: 'Animals', glyph: '<V>', make: () => new MantasScene() },
  { id: 'jellyfish', name: 'Jellyfish', short: 'Jellyfish', group: 'Animals', glyph: '(:)', make: () => new JellyfishScene() },
  { id: 'whales', name: 'Whales', short: 'Whales', group: 'Animals', glyph: '<==<', make: () => new WhalesScene() },
  { id: 'turtles', name: 'Sea Turtles', short: 'Turtles', group: 'Animals', glyph: '<O>', make: () => new TurtlesScene() },
  { id: 'starlings', name: 'Starlings', short: 'Starlings', group: 'Animals', glyph: '~v~', make: () => new StarlingsScene() },
  { id: 'fireflies', name: 'Fireflies', short: 'Fireflies', group: 'Animals', glyph: '.*.', make: () => new FirefliesScene() },
];

export function makeScene(id: SceneId): Scene {
  return (SCENES.find((s) => s.id === id) ?? SCENES[0]).make();
}
