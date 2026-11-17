// Diagnostic preload only: never included by the production entrypoint.
// Use exclusively with a sanitized environment and a disposable Temporal server.
const fs = require('node:fs');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { threadId, isMainThread } = require('node:worker_threads');

const tracePath = process.env.TEMPORAL_DIAG_TRACE;
if (!tracePath) throw new Error('TEMPORAL_DIAG_TRACE is required');
const fd = fs.openSync(tracePath, 'a');
const started = performance.now();
const write = (event, details = {}) => fs.writeSync(fd, JSON.stringify({
  ms: Math.round(performance.now() - started), pid: process.pid, threadId,
  event, ...details,
}) + '\n');
write('preload', { node: process.version, isMainThread });

const wrapped = Symbol('startup diagnostic wrapper');
const phase = (target, name, label, queue = false) => {
  const original = target?.[name];
  if (typeof original !== 'function' || original[wrapped]) return;
  const replacement = function (...args) {
    const details = queue ? { queue: args[0]?.taskQueue } : {};
    const at = performance.now();
    write(label + ':begin', details);
    // Explicit failure injection in disposable tests only; this preload is never
    // imported by the application. Neither case represents a discovered cause.
    if (label === 'Worker.create' && args[0]?.taskQueue === 'main') {
      if (process.env.TEMPORAL_DIAG_FAULT === 'async-create') {
        write('injected:async-create-stall');
        return new Promise(() => {});
      }
      if (process.env.TEMPORAL_DIAG_FAULT === 'sync-create') {
        write('injected:sync-create-stall');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
    }
    const done = () => write(label + ':end', { ...details, elapsedMs: Math.round(performance.now() - at) });
    const fail = error => {
      write(label + ':error', { ...details, name: error?.name, message: String(error?.message || error) });
      throw error;
    };
    try {
      const result = original.apply(this, args);
      if (result && typeof result.then === 'function') return result.then(value => { done(); return value; }, fail);
      done();
      return result;
    } catch (error) { return fail(error); }
  };
  replacement[wrapped] = true;
  target[name] = replacement;
};

const load = Module._load;
const own = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key);
phase(process, 'dlopen', 'native.dlopen');
phase(process.report, 'getReport', 'process.report.getReport');
Module._load = function (request, parent, isMain) {
  // Log names only, never module exports, environment, arguments, or payloads.
  write('require:begin', { request, parent: parent?.filename });
  let result;
  try { result = load.apply(this, arguments); }
  catch (error) { write('require:error', { request, name: error?.name, message: error?.message }); throw error; }
  write('require:end', { request });
  if (request === '@nestjs/core' || own(result, 'NestFactory')) {
    phase(result.NestFactory, 'create', 'NestFactory.create');
  }
  if (request === '@temporalio/worker' || own(result, 'NativeConnection')) {
    phase(result.NativeConnection, 'connect', 'NativeConnection.connect');
    phase(result.Worker, 'create', 'Worker.create', true);
    phase(result.Worker, 'getOrCreateBundle', 'workflow.bundle');
    phase(result.Worker, 'createWorkflowCreator', 'workflow.creator');
    phase(result.Worker?.prototype, 'run', 'Worker.run');
  }
  if (own(result, 'Runtime')) {
    phase(result.Runtime, 'create', 'Runtime.create');
    phase(result.Runtime?.prototype, 'registerWorker', 'Runtime.registerWorker');
    phase(result.Runtime?.prototype, 'createNativeClient', 'Runtime.createNativeClient');
  }
  if (own(result, 'native')) {
    for (const name of ['newRuntime', 'newClient', 'newWorker']) phase(result.native, name, 'native.' + name);
  }
  if (own(result, 'WorkflowCodeBundler')) phase(result.WorkflowCodeBundler.prototype, 'createBundle', 'Webpack.createBundle');
  if (own(result, 'TemporalWorkerManagerService')) {
    for (const name of ['onModuleInit', 'initializeMultipleWorkers', 'onApplicationBootstrap', 'createConnection'])
      phase(result.TemporalWorkerManagerService.prototype, name, 'WorkerManager.' + name);
  }
  return result;
};

setInterval(() => write('event-loop:tick'), 1000).unref();
process.on('exit', code => write('process:exit', { code }));
