import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import { readMcpOutputSchema } from './.runtime/reader-core/extract.mjs';
import { assertPublicHttpUrl } from './.runtime/reader-core/extract-batch-c1/url-guard.mjs';
import { canonicalScope, sameScope } from './store.mjs';

const id = z.number().int().positive();
export const inputSchema = z.object({ url: z.string().max(4096), maxChars: z.number().int().min(1).max(40000) }).strict();
// A deliberately narrow subset of 2.4.1's actual DoTaskActionSchema.
// task.input is a source-supported string. Its JSON encoding below is OUR fixture protocol.
const envelope = z.object({
  type: z.literal('do-task'), workspaceExecutionId: id,
  me: z.object({ id, name: z.string(), kind: z.literal('external'), isBuiltByAgentBuilder: z.literal(false) }).strict(),
  task: z.object({ id, description: z.string(), input: z.string().max(8192),
    dependencies: z.array(z.never()).max(0), humanAssistanceRequests: z.array(z.never()).max(0) }).strict(),
  workspace: z.object({ id, goal: z.string(), bucket_folder: z.string(), agents: z.array(z.never()).max(0) }).strict(),
  integrations: z.array(z.never()).max(0), memories: z.array(z.never()).max(0),
}).strict();
const refuse = code => Object.assign(Error(code), { code, status: 400 });

export class OfflineReaderAgent extends Agent {
  constructor({ scope, apiKey, authToken, store, reader, providerOrigin }) {
    scope = canonicalScope(scope);
    for (const key of ['workspaceId', 'taskId', 'agentId', 'executionId']) id.parse(scope?.[key]);
    if (!scope?.account || !apiKey?.startsWith('synthetic-') || !authToken?.startsWith('synthetic-')) throw Error('explicit synthetic scope and credentials required');
    const origin = new URL(providerOrigin);
    if (origin.origin !== providerOrigin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw Error('loopback fixture provider required');
    if (process.env.OPENSERV_API_URL !== providerOrigin || process.env.OPENSERV_RUNTIME_URL !== providerOrigin) throw Error('SDK origins must be fixed before import');
    super({ systemPrompt: 'Deterministic offline reader fixture. No model runtime.', apiKey, authToken, port: 1 });
    if (!sameScope(store.scope, scope)) throw Error('store scope mismatch');
    this.scope = Object.freeze({ ...scope }); this.store = store; this.reader = reader;
    this.providerOrigin = providerOrigin; this.transportCalls = []; this.pending = null;
    // Keep SDK startup, router, JSON parser and bcrypt auth. Pin its listen call.
    const listen = this.app.listen.bind(this.app);
    this.app.listen = port => listen(port, '127.0.0.1');
    this.port = 0;
    // Prevent all non-root SDK capability routes; nothing can fall through to models.
    this.app.use((req, res, next) => {
      if (req.method !== 'POST' || req.path !== '/') return res.status(404).json({ error: 'unknown_route' });
      next();
    });
  }
  async start() {
    await super.start();
    // Express's default error body is HTML. Return only stable refusal codes.
    this.app.use((error, _req, res, _next) => {
      res.status(error.status === 400 ? 400 : 503).json({ error: error.status === 400 ? error.code || 'invalid_request' : 'adapter_unreceived' });
    });
    const s = this.scope;
    const prefix = `/workspaces/${s.workspaceId}/tasks/${s.taskId}`;
    const guard = config => {
      const method = config.method.toUpperCase();
      const allowed = new Set([`GET ${prefix}/detail`, `PUT ${prefix}/complete`, `POST ${prefix}/error`]);
      const call = `${method} ${config.url}`;
      this.transportCalls.push(call);
      if (config.baseURL !== this.providerOrigin || !allowed.has(call)) throw Error('forbidden_provider_transport');
      config.timeout = 1500; config.maxRedirects = 0; config.proxy = false;
      return config;
    };
    this.apiClient.interceptors.request.use(guard);
    this.runtimeClient.interceptors.request.use(config => { this.transportCalls.push(`FORBIDDEN ${config.url}`); throw Error('runtime_disabled'); });
    return this.server.address();
  }
  validate(raw) {
    let action, input;
    try { action = envelope.parse(raw); input = inputSchema.parse(JSON.parse(action.task.input)); }
    catch { throw refuse('invalid_action_or_input'); }
    const s = this.scope;
    if (action.workspace.id !== s.workspaceId || action.task.id !== s.taskId || action.me.id !== s.agentId || action.workspaceExecutionId !== s.executionId) throw refuse('scope_mismatch');
    try { assertPublicHttpUrl(input.url); } catch { throw refuse('unsafe_url'); }
    return { action, input };
  }
  // SDK public router calls this override. Awaiting replaces its fire-and-forget ack.
  async handleRootRoute(req) {
    try {
      const validated = this.validate(req.body);
      return await this.doTask(validated.action);
    } catch (error) {
      if (error.status === 400) throw error;
      throw Object.assign(Error('adapter_unreceived'), { code: 'adapter_unreceived', status: 503 });
    }
  }
  async doTask(raw) {
    const { action, input } = this.validate(raw);
    const original = this.store.read();
    if (original && JSON.stringify(original.action) !== JSON.stringify(action)) throw refuse('original_task_mismatch');
    if (this.pending) return this.pending;
    if (original) return this.recover();
    this.pending = this.execute(action, input);
    try { return await this.pending; } finally { this.pending = null; }
  }
  async execute(action, input) {
    let record = this.store.write({ scope: this.scope, action, input, state: 'running', startedAt: new Date().toISOString() });
    // A missing task read does not establish authority for an error mutation.
    let task;
    try { task = await this.getTaskDetail(this.ids()); }
    catch { return this.store.write({ ...record, state: 'task_read_unknown' }); }
    if (task.id !== this.scope.taskId || task.assigneeAgentId !== this.scope.agentId || task.input !== action.task.input || task.status !== 'in-progress') {
      return this.store.write({ ...record, state: 'refused_task_detail' });
    }
    this.controller = new AbortController();
    let value;
    try {
      value = await this.reader.run(input, this.controller.signal);
      readMcpOutputSchema.parse(value);
    } catch (error) {
      const code = ['timeout', 'cancelled', 'ssrf_blocked', 'redirect_error', 'unsupported_encoding', 'invalid_response'].includes(error.code) ? error.code : 'reader_unreceived';
      record = this.store.write({ ...record, state: 'error_recorded', error: code });
      try { await this.markTaskAsErrored({ ...this.ids(), error: code }); return this.store.write({ ...record, state: 'error_acknowledged' }); }
      catch { return this.store.write({ ...record, state: 'error_unknown' }); }
    } finally { this.controller = null; }
    // Durable full original result BEFORE the only completion PUT.
    record = this.store.write({ ...record, state: 'result_recorded', output: JSON.stringify(value) });
    try {
      await this.completeTask({ ...this.ids(), output: record.output });
      return this.store.write({ ...record, state: 'completion_acknowledged' });
    } catch {
      this.store.write({ ...record, state: 'completion_unknown' });
      return this.recover();
    }
  }
  ids() { return { workspaceId: this.scope.workspaceId, taskId: this.scope.taskId }; }
  async recover() {
    const record = this.store.read();
    if (!record) throw refuse('no_original_task');
    if (!sameScope(record.scope, this.scope)) throw refuse('stored_scope_mismatch');
    if (record.state === 'completion_acknowledged' || record.state === 'completion_readback') return record;
    // Read-only original-ID recovery. No PUT, source rerun or error side effect.
    try {
      const task = await this.getTaskDetail(this.ids());
      if (record.output && task.id === this.scope.taskId && task.assigneeAgentId === this.scope.agentId && task.status === 'done' && task.output === record.output) {
        return this.store.write({ ...record, state: 'completion_readback' });
      }
    } catch { /* A failed or unreceived read proves no outcome. */ }
    return { ...record, outcome: 'unknown' };
  }
  cancel() { this.controller?.abort(); }
  async stop() { this.cancel(); if (this.pending) await this.pending; await super.stop(); }
}
