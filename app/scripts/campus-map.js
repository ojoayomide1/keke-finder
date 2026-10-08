const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "map-data", "source");
const EXPORT_PATH = path.join(ROOT, "map-data", "exports", "veritas-map.json");

const ALLOWED_STATUS = new Set(["open", "closed", "construction", "draft", "needs_survey"]);

const LAYERS = {
  roads: {
    geometry: ["LineString", "MultiLineString"],
    required: ["id", "status"],
  },
  walkways: {
    geometry: ["LineString", "MultiLineString"],
    required: ["id", "status"],
  },
  buildings: {
    geometry: ["Polygon", "MultiPolygon"],
    required: ["id", "status"],
  },
  entrances: {
    geometry: ["Point"],
    required: ["id", "building_id"],
  },
  places: {
    geometry: ["Point"],
    required: ["id", "name", "category"],
  },
  routing_nodes: {
    geometry: ["Point"],
    required: ["id", "status"],
  },
  routing_edges: {
    geometry: ["LineString"],
    required: ["id", "from_node", "to_node"],
  },
};

function readGeoJson(layerName) {
  const filePath = path.join(SOURCE_DIR, `${layerName}.geojson`);
  if (!fs.existsSync(filePath)) {
    return { type: "FeatureCollection", features: [] };
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error(`${layerName}.geojson must be a FeatureCollection`);
  }
  return data;
}

function getFeatureId(feature) {
  return feature.properties?.id || feature.id;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validatePosition(position, layerName, featureId, errors) {
  const [lng, lat] = position;
  if (!isNumber(lng) || !isNumber(lat)) {
    errors.push(`${layerName}:${featureId} has non-numeric coordinates`);
    return;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    errors.push(`${layerName}:${featureId} has out-of-range coordinates`);
  }
}

function visitCoordinates(geometry, callback) {
  if (!geometry) return;
  if (geometry.type === "Point") callback(geometry.coordinates);
  if (geometry.type === "LineString") geometry.coordinates.forEach(callback);
  if (geometry.type === "Polygon") geometry.coordinates.flat(1).forEach(callback);
  if (geometry.type === "MultiLineString") geometry.coordinates.flat(1).forEach(callback);
  if (geometry.type === "MultiPolygon") geometry.coordinates.flat(2).forEach(callback);
}

function validateFeature(layerName, feature, ids, errors) {
  const config = LAYERS[layerName];
  const id = getFeatureId(feature);

  if (!id) {
    errors.push(`${layerName} has a feature without id`);
    return;
  }
  if (ids.has(id)) errors.push(`${layerName}:${id} duplicates another feature id`);
  ids.add(id);

  if (!feature.geometry || !config.geometry.includes(feature.geometry.type)) {
    errors.push(`${layerName}:${id} must use geometry ${config.geometry.join(" or ")}`);
  }

  for (const field of config.required) {
    const value = field === "id" ? id : feature.properties?.[field];
    if (value == null || value === "") {
      errors.push(`${layerName}:${id} is missing required field '${field}'`);
    }
  }

  const status = feature.properties?.status;
  if (status && !ALLOWED_STATUS.has(status)) {
    errors.push(`${layerName}:${id} has invalid status '${status}'`);
  }

  visitCoordinates(feature.geometry, (position) => validatePosition(position, layerName, id, errors));
}

function lngLatToLatLng(position) {
  return [position[1], position[0]];
}

function lineFeatureToPath(feature, fallbackType) {
  const props = feature.properties || {};
  const id = getFeatureId(feature);
  const coordinates = feature.geometry.coordinates;
  const firstLine = feature.geometry.type === "MultiLineString" ? coordinates[0] : coordinates;
  return {
    id,
    name: props.name || id,
    type: props.type || props.road_type || fallbackType,
    walkable: props.walkable !== false,
    drivable: props.drivable === true,
    access: props.access || "unknown",
    status: props.status || "draft",
    points: firstLine.map(lngLatToLatLng),
  };
}

function polygonFeatureToBuilding(feature) {
  const props = feature.properties || {};
  const id = getFeatureId(feature);
  const rings = feature.geometry.type === "MultiPolygon"
    ? feature.geometry.coordinates[0]
    : feature.geometry.coordinates;
  const outerRing = rings[0] || [];
  return {
    id,
    name: props.name || id,
    type: props.building_type || props.type || "building",
    status: props.status || "draft",
    points: outerRing.map(lngLatToLatLng),
  };
}

function pointFeatureToLocation(feature) {
  const props = feature.properties || {};
  const id = getFeatureId(feature);
  const [lng, lat] = feature.geometry.coordinates;
  return {
    id,
    name: props.name || id,
    category: props.category || "service",
    lat,
    lng,
  };
}

function pointFeatureToRoutingNode(feature) {
  const props = feature.properties || {};
  const id = getFeatureId(feature);
  const [lng, lat] = feature.geometry.coordinates;
  return {
    id,
    name:      props.name      || id,
    node_type: props.node_type || "unknown",
    lat,
    lng,
    status: props.status || "open",
  };
}

function lineFeatureToRoutingEdge(feature) {
  const props = feature.properties || {};
  const id = getFeatureId(feature);
  return {
    id,
    from_node: props.from_node,
    to_node:   props.to_node,
    walkable:  props.walkable !== false,
    drivable:  props.drivable === true,
    access:    props.access   || "public",
    status:    props.status   || "open",
  };
}

function buildExport(layers) {
  const roads     = layers.roads.features.map((f) => lineFeatureToPath(f, "road"));
  const walkways  = layers.walkways.features.map((f) => lineFeatureToPath(f, "walkway"));
  const buildings = layers.buildings.features.map(polygonFeatureToBuilding);
  const places    = layers.places.features.map(pointFeatureToLocation);
  const routingNodes = layers.routing_nodes.features.map(pointFeatureToRoutingNode);
  const routingEdges = layers.routing_edges.features.map(lineFeatureToRoutingEdge);

  return {
    version: "1.0.0",
    updated_at: new Date().toISOString(),
    layers: Object.fromEntries(
      Object.keys(LAYERS).map((layerName) => [layerName, layers[layerName].features])
    ),
    app: {
      locations:    places.filter((p) => p.category !== "pickup"),
      rideStops:    places.filter((p) => p.category === "pickup"),
      paths:        [...roads, ...walkways].filter((p) => p.status !== "closed"),
      buildings:    buildings.filter((b) => b.status !== "closed"),
      routingNodes: routingNodes.filter((n) => n.status !== "closed"),
      routingEdges: routingEdges.filter((e) => e.status !== "closed"),
    },
  };
}

function validateAll(layers) {
  const errors = [];
  const ids = new Set();
  const routingNodeIds = new Set();

  for (const layerName of Object.keys(LAYERS)) {
    layers[layerName].features.forEach((feature) => {
      validateFeature(layerName, feature, ids, errors);
      if (layerName === "routing_nodes") routingNodeIds.add(getFeatureId(feature));
    });
  }

  layers.routing_edges.features.forEach((feature) => {
    const id = getFeatureId(feature);
    const props = feature.properties || {};
    if (props.from_node && !routingNodeIds.has(props.from_node)) {
      errors.push(`routing_edges:${id} references missing from_node '${props.from_node}'`);
    }
    if (props.to_node && !routingNodeIds.has(props.to_node)) {
      errors.push(`routing_edges:${id} references missing to_node '${props.to_node}'`);
    }
  });

  return errors;
}

function main() {
  const command = process.argv[2] || "validate";
  const layers = Object.fromEntries(Object.keys(LAYERS).map((layerName) => [layerName, readGeoJson(layerName)]));
  const errors = validateAll(layers);

  if (errors.length > 0) {
    console.error(`Campus map validation failed with ${errors.length} error(s):`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  if (command === "export") {
    const output = buildExport(layers);
    fs.mkdirSync(path.dirname(EXPORT_PATH), { recursive: true });
    fs.writeFileSync(EXPORT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Exported ${EXPORT_PATH}`);
    return;
  }

  if (command !== "validate") {
    console.error(`Unknown command '${command}'. Use 'validate' or 'export'.`);
    process.exit(1);
  }

  console.log("Campus map validation passed.");
}

main();

