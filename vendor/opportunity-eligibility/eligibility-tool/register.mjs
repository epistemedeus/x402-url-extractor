// Registration helper for an MCP SDK host such as the free surface (McpServer from @modelcontextprotocol/sdk
// with zod 4). The host passes its own server and zod, so this adapter adds no dependency.
//   import { z } from 'zod';
//   registerOpportunityTools(server, { z, ctx: { radarLib: process.env.RADAR_LIB } });
//   registerOpportunityTools(server, { z, only: ['opportunity_compare'] });   // compare-only, reads nothing
import { toolDescriptors, callTool } from './tools.mjs';

// Converts the small JSON Schema subset in tools.mjs to a zod raw shape. Unknown keys inside nested
// records stay allowed (loose objects), so record payloads pass through unchanged.
export function zodFromJsonSchema(z, s) {
  const loose = (shape) => (typeof z.looseObject === 'function' ? z.looseObject(shape) : z.object(shape).passthrough());
  if ('const' in s) return z.literal(s.const);
  switch (s.type) {
    case 'string': {
      if (s.enum) return z.enum(s.enum);
      let v = z.string();
      if (s.minLength !== undefined) v = v.min(s.minLength);
      if (s.maxLength !== undefined) v = v.max(s.maxLength);
      if (s.pattern) v = v.regex(new RegExp(s.pattern));
      return v;
    }
    case 'integer': {
      let v = z.number().int();
      if (s.minimum !== undefined) v = v.min(s.minimum);
      if (s.maximum !== undefined) v = v.max(s.maximum);
      return v;
    }
    case 'array': {
      let v = z.array(s.items ? zodFromJsonSchema(z, s.items) : z.unknown());
      if (s.minItems !== undefined) v = v.min(s.minItems);
      if (s.maxItems !== undefined) v = v.max(s.maxItems);
      return v;
    }
    case 'object':
      return loose(zodShape(z, s));
    default:
      return z.unknown();
  }
}

export function zodShape(z, s) {
  return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, child]) => {
    const v = zodFromJsonSchema(z, child);
    return [k, (s.required ?? []).includes(k) ? v : v.optional()];
  }));
}

export function registerOpportunityTools(server, { z, ctx = {}, only = null } = {}) {
  if (!server || typeof server.registerTool !== 'function') throw new TypeError('server.registerTool is required');
  if (!z || typeof z.object !== 'function') throw new TypeError('zod (z) is required');
  const registered = [];
  for (const d of toolDescriptors().filter((t) => !only || only.includes(t.name))) {
    const config = {
      title: d.title,
      description: d.description,
      inputSchema: zodShape(z, d.inputSchema),
      outputSchema: zodShape(z, d.outputSchema),
      annotations: d.annotations,
      _meta: d._meta,
    };
    registered.push([d.name, server.registerTool(d.name, config, async (args) => callTool(d.name, args, ctx))]);
  }
  return registered;
}
