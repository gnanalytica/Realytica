/** Google's basemap as a Leaflet layer. The package ships no types of its own. */
declare module 'leaflet.gridlayer.googlemutant' {
  import { GridLayer, type GridLayerOptions } from 'leaflet';

  export interface GoogleMutantOptions extends GridLayerOptions {
    type?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid';
    styles?: unknown[];
  }

  export default class GoogleMutant extends GridLayer {
    constructor(options?: GoogleMutantOptions);
  }
}
