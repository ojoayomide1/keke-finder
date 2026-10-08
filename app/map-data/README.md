# Veritas Campus Map Data

This folder is the source of truth for the custom Veritas 2D campus map.

For TerraLab AI Segmentation output, follow `map-data/docs/terralab-qgis-workflow.md` before exporting data into the app.

QGIS should be used for editing. Export each edited layer from QGIS as GeoJSON into
`map-data/source/`, then run:

```txt
npm run map:export
npm run map:validate
```

The app consumes `map-data/exports/veritas-map.json`. Do not hand-edit that export
file except for emergency debugging.

## Editing Format

Use a QGIS GeoPackage while editing:

```txt
veritas-campus.qgz
veritas-campus.gpkg
```

Export these layers to GeoJSON:

```txt
roads.geojson
walkways.geojson
buildings.geojson
entrances.geojson
places.geojson
routing_nodes.geojson
routing_edges.geojson
```

All exports must use `EPSG:4326` coordinates. GeoJSON coordinates are
`[longitude, latitude]`; the app export converts route/render points to
`[latitude, longitude]`.

