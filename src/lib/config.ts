/* Area and service configuration. Change the focus area here. */
export const AREA = {
  name: 'Valenzuela City School of Mathematics and Science',
  street: 'A. Pablo St',
  lng: 120.96665,
  lat: 14.69198,
  /** OpenStreetMap streets are loaded within this radius (m) */
  roadRadius: 750,
  /** simulated accessibility values exist inside this radius (m) */
  dataRadius: 500,
} as const;

export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';

/** used only if the vector style cannot be loaded */
export const FALLBACK_RASTER_STYLE = {
  version: 8 as const,
  sources: {
    osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};
