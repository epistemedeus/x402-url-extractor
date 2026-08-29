function fail(message) {
  throw new Error(`Machine construction surface invalid: ${message}`);
}

function stable(value) {
  return JSON.stringify(value);
}

function projectResourceServiceMetadata(primary, fallback = {}) {
  const serviceName = primary?.serviceName ?? fallback?.serviceName;
  const tags = primary?.tags ?? fallback?.tags;
  const iconUrl = primary?.iconUrl ?? fallback?.iconUrl;
  return {
    ...(serviceName !== undefined ? { serviceName } : {}),
    ...(tags !== undefined ? { tags: [...tags] } : {}),
    ...(iconUrl !== undefined ? { iconUrl } : {}),
  };
}

export function buildX402ManifestItems({ resources, actions, acceptsFor, alternate = null } = {}) {
  if (!Array.isArray(resources) || !Array.isArray(actions) || typeof acceptsFor !== "function") {
    fail("resources, actions, and acceptsFor are required");
  }
  const actionsByRoute = new Map(actions.map((action) => [action.route, action]));
  const items = resources.map((resource) => {
    const route = new URL(resource.url).pathname;
    const action = actionsByRoute.get(route);
    return {
      resource: {
        url: action?.request?.exampleUrl || resource.url,
        routeTemplate: route,
        description: resource.description,
        mimeType: resource.mimeType,
        ...projectResourceServiceMetadata(action, resource),
      },
      type: "http",
      request: action?.request || null,
      accepts: acceptsFor(resource.amount),
    };
  });
  if (alternate) {
    items.push({
      resource: {
        url: alternate.request?.exampleUrl || alternate.url,
        routeTemplate: alternate.route,
        description: alternate.description,
        mimeType: alternate.mimeType,
        ...projectResourceServiceMetadata(alternate),
      },
      type: "http",
      request: alternate.request || null,
      accepts: alternate.accepts,
    });
  }
  return items;
}

export function validateConstructionSurfaceParity({ actions, manifestItems, agentCard, alternateAccess = null } = {}) {
  if (!Array.isArray(actions) || actions.length === 0) fail("actions are required");
  if (!Array.isArray(manifestItems)) fail("manifest items are required");
  const routes = actions.map((action) => action.route);
  if (new Set(routes).size !== routes.length) fail("action routes must be unique");

  let getExamples = 0;
  let postExamples = 0;
  for (const action of actions) {
    const method = String(action.method || "").toUpperCase();
    if (!/^\/[^?#]+$/.test(action.route || "")) fail("action route is invalid");
    if (!action.request || action.request.method !== method || !action.request.schema || !action.request.example) {
      fail(`${method} ${action.route} lacks its canonical request contract`);
    }
    if (method === "GET") {
      if (typeof action.request.exampleUrl !== "string" || !action.request.exampleUrl.startsWith(`${action.url}?`)) {
        fail(`GET ${action.route} lacks a callable example URL`);
      }
      getExamples += 1;
    } else if (method === "POST") {
      if (action.request.example.bodyType !== "json" || !action.request.example.body || typeof action.request.example.body !== "object") {
        fail(`POST ${action.route} lacks a JSON body example`);
      }
      postExamples += 1;
    } else {
      fail(`${method} ${action.route} uses an unsupported method`);
    }

    const manifest = manifestItems.find((item) => item?.resource?.routeTemplate === action.route);
    if (!manifest) fail(`${method} ${action.route} is missing from the x402 manifest`);
    if (stable(manifest.request) !== stable(action.request)) fail(`${method} ${action.route} request contract drifted in the x402 manifest`);
    const expectedUrl = action.request.exampleUrl || action.url;
    if (manifest.resource.url !== expectedUrl) fail(`${method} ${action.route} has a non-callable manifest URL`);
    if (action.serviceName !== undefined && manifest.resource.serviceName !== action.serviceName) {
      fail(`${method} ${action.route} serviceName drifted in the x402 manifest`);
    }
    if (action.tags !== undefined && stable(manifest.resource.tags) !== stable(action.tags)) {
      fail(`${method} ${action.route} tags drifted in the x402 manifest`);
    }
    if (action.iconUrl !== undefined && manifest.resource.iconUrl !== action.iconUrl) {
      fail(`${method} ${action.route} iconUrl drifted in the x402 manifest`);
    }
  }

  const routeSkills = (agentCard?.skills || []).filter((skill) => String(skill?.id || "").startsWith("discover-paid-action-"));
  if (routeSkills.length !== actions.length) fail("A2A route-skill count does not match the action catalog");
  for (const action of actions.filter((entry) => entry.method === "GET")) {
    const skill = routeSkills.find((entry) => String(entry.description || "").includes(` ${action.route} `));
    if (!skill || !String(skill.description).includes(action.request.exampleUrl)) {
      fail(`GET ${action.route} callable example is missing from A2A`);
    }
  }

  if (alternateAccess) {
    if (!alternateAccess.request?.exampleUrl) fail(`alternate ${alternateAccess.route} lacks a callable example URL`);
    const alternateItem = manifestItems.find((item) => item?.resource?.routeTemplate === alternateAccess.route);
    if (!alternateItem) fail(`alternate ${alternateAccess.route} is missing from the x402 manifest`);
    if (stable(alternateItem.request) !== stable(alternateAccess.request)) fail(`alternate ${alternateAccess.route} request contract drifted`);
    if (alternateItem.resource.url !== alternateAccess.request.exampleUrl) fail(`alternate ${alternateAccess.route} has a non-callable manifest URL`);
    if (alternateAccess.serviceName !== undefined && alternateItem.resource.serviceName !== alternateAccess.serviceName) {
      fail(`alternate ${alternateAccess.route} serviceName drifted`);
    }
    if (alternateAccess.tags !== undefined && stable(alternateItem.resource.tags) !== stable(alternateAccess.tags)) {
      fail(`alternate ${alternateAccess.route} tags drifted`);
    }
    if (alternateAccess.iconUrl !== undefined && alternateItem.resource.iconUrl !== alternateAccess.iconUrl) {
      fail(`alternate ${alternateAccess.route} iconUrl drifted`);
    }
  }

  return {
    ok: true,
    actionCount: actions.length,
    getExamples,
    postExamples,
    alternateExamples: alternateAccess ? 1 : 0,
  };
}
