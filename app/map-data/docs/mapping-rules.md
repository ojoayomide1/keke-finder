# Veritas Mapping Rules

## Required Rules

- AI segmentation output is raw draft data until it is exported into a clean production layer and given Veritas metadata.

- Every feature must have a stable `id`.
- Use lowercase snake case IDs, for example `building_library` or `road_main_gate_001`.
- Every important building must have at least one entrance point.
- Every route edge must have `from_node` and `to_node`.
- Every routing edge must connect real routing nodes.
- Do not connect paths just because they visually cross; connect only if people can move between them.
- Mark blocked, private, staff-only, or construction paths with `access` and `status`.
- Keep satellite imagery as reference only; field survey decides names, entrances, access, and route rules.

## Layer Meaning

- `roads`: vehicle-capable campus roads.
- `walkways`: pedestrian paths and shortcuts.
- `buildings`: building footprints.
- `entrances`: where users actually enter buildings.
- `places`: searchable landmarks and destinations.
- `routing_nodes`: junctions, gates, entrances, and decision points.
- `routing_edges`: routeable connections between nodes.

## Recommended Attribute Values

`access`:

```txt
public
student
staff
restricted
private
unknown
```

`status`:

```txt
open
closed
construction
draft
needs_survey
```

`surface`:

```txt
paved
unpaved
gravel
grass
unknown
```

