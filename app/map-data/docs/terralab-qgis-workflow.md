# TerraLab AI Segmentation To Production Buildings

Use TerraLab for fast drafting. Do final ownership and cleanup in the `buildings`
layer.

## 1. Preserve The Raw AI Output

1. In QGIS, right-click the TerraLab output layer named `AI Segmentation`.
2. Rename it to `ai_buildings_raw`.
3. Keep it visible only as a reference/backup.
4. Do not export `ai_buildings_raw` into the app.

## 2. Create The Clean Buildings Layer

1. Right-click `ai_buildings_raw`.
2. Choose `Export` -> `Save Features As`.
3. Format: `GeoPackage`.
4. File: `veritas-campus.gpkg`.
5. Layer name: `buildings`.
6. CRS: `EPSG:4326 - WGS 84`.
7. Click `OK`.

All later edits should happen in this clean `buildings` layer.

## 3. Add Required Fields

Open the `buildings` attribute table, toggle editing, and add:

```txt
id              Text
name            Text
building_type   Text
department      Text
floors          Integer
status          Text
updated_at      Date
source          Text
confidence      Decimal
needs_survey    Boolean
```

If TerraLab already created fields like `confidence`, keep them. Only add missing
fields.

## 4. Fill Minimum Production Metadata

Every building must have:

```txt
id
status
source
```

Recommended values:

```txt
source: terralab_ai_segmentation
status: open
status: needs_survey
status: draft
```

Use `needs_survey = true` for buildings you cannot confirm while off campus.

## 5. Clean The Shapes

Delete:

```txt
shadows
tiny roof fragments
containers that are not useful destinations
duplicate polygons
wrong building selections
```

Fix:

```txt
split buildings that should be one building
merged buildings that should be separate
wobbly corners
missing roof sections
```

Use the QGIS Vertex Tool for manual fixes. Use TerraLab simplify/right-angle tools
only when the shape still matches the satellite image.

## 6. Export To The Repo

1. Right-click `buildings`.
2. `Export` -> `Save Features As`.
3. Format: `GeoJSON`.
4. CRS: `EPSG:4326 - WGS 84`.
5. Save as:

```txt
map-data/source/buildings.geojson
```

Then run:

```txt
npm.cmd run map:validate
npm.cmd run map:export
```

If validation fails, fix the listed feature in QGIS and export again.

## Road Guidance

TerraLab can detect `roads and paved surfaces`, but that output is usually
polygon areas. Keep it as `ai_roads_raw`.

For navigation, create clean `roads` and `walkways` LineString layers manually
from the center of the visible route. The app router needs lines, not road-area
polygons.