import { createFramePerformance } from './frame-performance.js';

/** Fixed simulation steps for the explicit inspection page only. The normal
 * application keeps its measured frame delta and never records interaction.
 */
export function createInspectionClock() {
  let paused = false;
  let steps = 0;
  let recording = null;
  return {
    setPaused(value) {
      paused = Boolean(value);
    },
    step() {
      steps += 1;
    },
    start(updates) {
      if (!Number.isInteger(updates) || updates < 1 || updates > 600) {
        throw new RangeError('Choose between 1 and 600 updates');
      }
      if (recording) throw new Error('A recording is already active');
      recording = { frame: 0, updates };
    },
    delta(measured) {
      if (recording) return recording.frame === 0 ? 0 : 1000 / 60;
      if (!paused) return measured;
      if (steps > 0) {
        steps -= 1;
        return 1000 / 60;
      }
      return 0;
    },
    rendered() {
      if (!recording) return null;
      const sample = { ...recording, final: recording.frame === recording.updates };
      if (sample.final) recording = null;
      else recording.frame += 1;
      return sample;
    },
    get paused() {
      return paused;
    },
  };
}

/** Bounded request metadata only: no sound buffers, asset URLs or user text. */
export function createInspectionSoundTrace({ capacity = 256, time = () => 0 } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024) {
    throw new RangeError('Sound trace capacity must be between 1 and 1024');
  }
  const records = new Array(capacity);
  const symbolName = (value) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(value)
    ? value : null;
  let total = 0;
  let startedAtMs = time();
  return {
    record({ operation, symbol, sourceSymbol, options = {} }) {
      if (!['play', 'startLoop'].includes(operation)) return null;
      const scalars = {};
      for (const key of ['gain', 'pan', 'pitch', 'speed']) {
        if (Number.isFinite(options?.[key])) scalars[key] = options[key];
      }
      if (typeof options?.loop === 'boolean') scalars.loop = options.loop;
      const event = {
        sequence: total + 1,
        logicalTimeMs: time(),
        operation,
        symbol: symbolName(symbol),
        sourceSymbol: symbolName(sourceSymbol),
        options: scalars,
      };
      records[total % capacity] = event;
      total++;
      return event;
    },
    reset() {
      records.fill(undefined);
      total = 0;
      startedAtMs = time();
    },
    snapshot() {
      const count = Math.min(total, capacity);
      return {
        version: 1,
        capacity,
        total,
        dropped: total - count,
        startedAtMs,
        logicalTimeMs: time(),
        requests: Array.from({ length: count }, (_, index) => {
          const event = records[(total - count + index) % capacity];
          return { ...event, options: { ...event.options } };
        }),
      };
    },
  };
}

export function createMenuInspection({ screen, canvas }) {
  const tools = document.getElementById('inspection-tools');
  if (!tools) return null;
  const clock = createInspectionClock();
  const performanceRun = createFramePerformance();
  const field = (id) => document.getElementById(`inspection-${id}`);
  const output = field('result');
  let armed = false;
  let saving = false;
  let source = null;
  let current = null;
  let samples = [];
  let run = null;
  let trigger = null;
  let simulatedDate = Date.now();
  let elapsedMs = 0;
  let inspectionDisplay = null;
  const soundTrace = createInspectionSoundTrace({ time: () => elapsedMs });
  const soundOutput = field('sounds');
  const performanceOutput = field('performance');
  const performanceButton = field('measure');
  function cancelMeasurement(reason) {
    if (!performanceRun.active) return;
    performanceRun.cancel();
    performanceButton.disabled = false;
    performanceOutput.textContent = reason;
  }
  performanceButton?.addEventListener('click', () => {
    if (armed || saving || samples.length || clock.paused) {
      performanceOutput.textContent = 'Resume playback and finish recording before measuring.';
      return;
    }
    performanceRun.start();
    delete performanceOutput.dataset.measurement;
    performanceOutput.textContent = 'Measuring 300 frames… Keep this tab visible.';
    performanceButton.disabled = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelMeasurement('Measurement cancelled because the tab was hidden.');
    }
  });

  function updateSoundStatus(event = null) {
    const trace = soundTrace.snapshot();
    const latest = event ?? trace.requests.at(-1);
    const label = latest
      ? `${latest.operation} ${latest.symbol ?? 'unknown'}${latest.sourceSymbol
        ? ` → ${latest.sourceSymbol}` : ''} at ${latest.logicalTimeMs.toFixed(1)} ms`
      : 'none';
    soundOutput.textContent = `Sound requests: ${trace.total}; dropped: ${trace.dropped}. Latest: ${label}.`;
  }
  field('sounds-reset').addEventListener('click', () => {
    soundTrace.reset();
    updateSoundStatus();
  });
  updateSoundStatus();

  function fitDisplay() {
    if (!inspectionDisplay) return;
    const toolbarHeight = Math.ceil(tools.getBoundingClientRect().height);
    screen.style.width = `min(100vw, calc((100vh - ${toolbarHeight}px) * ${inspectionDisplay.outputAspect}))`;
    screen.style.height = `min(calc(100vh - ${toolbarHeight}px), ${100 / inspectionDisplay.outputAspect}vw)`;
  }
  // The optional trace row may wrap on narrower windows. Keep the source
  // viewport inside the available area rather than assuming a fixed toolbar.
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitDisplay).observe(tools);

  function fail(error) {
    output.textContent = error.message;
  }

  async function save(png, frame, comparison) {
    const response = await fetch('/__capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        png,
        channel: 'menu',
        kind: 'sequence',
        frame,
        aspectRatio: current.display.aspectRatio,
        logicalWidth: current.display.width,
        logicalHeight: current.display.height,
        comparison: { source, ...comparison },
      }),
    });
    if (!response.ok) throw new Error(`Capture save failed (${response.status})`);
    return (await response.json()).path;
  }

  async function saveSequence() {
    saving = true;
    const paths = [];
    try {
      for (const sample of samples) {
        const final = sample.frame === samples.length - 1;
        const path = await save(sample.png, sample.frame, {
          ...sample.metadata,
          sequenceId: run,
          index: sample.frame,
          total: samples.length,
          trigger,
          updatesPerSecond: 60,
          frameConvention: 'Frame zero follows the trigger event; later frames advance one 60 Hz update.',
          ...(final ? {
            sequenceManifest: {
              complete: true,
              frames: [...paths, { frame: sample.frame, currentCapture: true }],
            },
          } : {}),
        });
        paths.push({ frame: sample.frame, path });
        output.textContent = `Saved ${paths.length}/${samples.length} frames`;
      }
      output.textContent = `${paths.length} frames saved; final frame and sidecar: ${paths.at(-1).path}`;
    } finally {
      samples = [];
      saving = false;
    }
  }

  field('pause').addEventListener('click', () => {
    cancelMeasurement('Measurement cancelled because playback was paused.');
    clock.setPaused(!clock.paused);
    field('pause').textContent = clock.paused ? 'Play' : 'Pause';
  });
  field('step').addEventListener('click', () => {
    cancelMeasurement('Measurement cancelled because playback was stepped.');
    clock.setPaused(true);
    field('pause').textContent = 'Play';
    clock.step();
  });
  function armRecording() {
    if (saving || samples.length) return;
    cancelMeasurement('Measurement cancelled because capture was armed.');
    armed = true;
    trigger = field('trigger').value;
    output.textContent = `Armed. The next ${trigger} in the menu starts frame zero.`;
  }
  field('record').addEventListener('click', armRecording);
  field('record').title = 'Record next pointer action (F7)';
  function startRecording(event) {
    if (!armed || event.type !== trigger) return;
    try {
      clock.start(Number(field('length').value));
      cancelMeasurement('Measurement cancelled because sequence capture started.');
      run = crypto.randomUUID();
      armed = false;
      output.textContent = 'Recording complete simulation updates…';
    } catch (error) {
      fail(error);
    }
  }
  screen.addEventListener('click', startRecording, { capture: true });
  screen.addEventListener('pointerdown', startRecording, { capture: true });
  async function saveCurrentFrame() {
    if (!current || saving) return;
    cancelMeasurement('Measurement cancelled because a frame was captured.');
    try {
      const path = await save(canvas.toDataURL('image/png'), 0, {
        ...current, soundRequests: soundTrace.snapshot(),
      });
      output.textContent = `Saved ${path}`;
    } catch (error) {
      fail(error);
    }
  }
  field('save').addEventListener('click', saveCurrentFrame);
  field('save').title = 'Save current frame (F8)';
  // A keyboard capture keeps the pointer over the control being inspected.
  // Clicking the toolbar first would discard the very hover pose under review.
  document.addEventListener('keydown', (event) => {
    if (!['F7', 'F8'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'F7') armRecording();
    else void saveCurrentFrame();
  }, { capture: true });

  return {
    frameCandidate(timestamp, rendered) {
      performanceRun.candidate(timestamp, rendered);
    },
    beginFrame(timestamp) {
      performanceRun.begin(timestamp);
    },
    finishFrame() {
      const result = performanceRun.finish();
      if (!result) return;
      performanceButton.disabled = false;
      performanceOutput.textContent = `300 frames: CPU p50 ${result.cpuMilliseconds.p50.toFixed(2)} ms, ` +
        `p95 ${result.cpuMilliseconds.p95.toFixed(2)} ms; ` +
        `frame interval p95 ${result.frameMilliseconds.p95.toFixed(2)} ms. ` +
        'CPU submission only; not GPU execution time.';
      performanceOutput.dataset.measurement = JSON.stringify(result);
    },
    delta: (measured) => clock.delta(measured),
    date(delta) {
      simulatedDate += delta;
      elapsedMs += delta;
      return new Date(simulatedDate);
    },
    soundRequest(request) {
      const event = soundTrace.record(request);
      if (event) updateSoundStatus(event);
    },
    setDisplay(display) {
      inspectionDisplay = display;
      fitDisplay();
    },
    setSource(value) {
      source = { ...value, wadSha256: value.preparation?.wadSha256 };
    },
    rendered(metadata) {
      current = {
        ...structuredClone(metadata),
        soundRequests: soundTrace.snapshot(),
        performance: performanceRun.result,
      };
      const sample = clock.rendered();
      if (!sample) return;
      samples.push({
        frame: sample.frame,
        png: canvas.toDataURL('image/png'),
        metadata: current,
      });
      if (sample.final) void saveSequence().catch(fail);
    },
  };
}
