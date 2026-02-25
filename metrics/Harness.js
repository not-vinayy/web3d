export class BenchmarkHarness {
    constructor() {
        this.resetResults();

        // Settings
        this.warmupDuration = 1000; // 1 seconds
        this.targetDuration = 3; // 3 seconds of active recording after warmup
        this.durationMode = 'time'; // 'time' or 'frames'
        this.targetFrames = 120;

        // State
        this.initialized = false;
        this.isWarmingUp = true;
        this.isComplete = false;

        this.initStartTime = 0;
        this.startTime = 0;
        this.lastFrameTime = 0;
        this.activeFrameCount = 0;
        this.warmupFrameCount = 0;

        // For GPU timings WebGPU (optional, device specific)
        this.device = null; // Passed in if WebGPU
        this.gpuSupportTimestamp = false;
        this.gpuQuerySet = null;
        this.gpuResolveBuffer = null;
        this.gpuResultBuffer = null;

        // UI
        this.uiFps = document.getElementById('fps-value');
        this.uiFrameTime = document.getElementById('frametime-value');
        this.uiStatus = document.getElementById('status-value');
        this.uiAccumulator = 0;
        this.uiFrameCount = 0;
    }

    resetResults() {
        this.results = {
            frames: [],
            cpuTimes: [],
            gpuTimes: [], // WebGPU only
            totalTime: 0,
            fps: 0,
            initTime: 0,

            // Statistics derived later
            meanFrameTime: 0,
            stdFrameTime: 0,
            p95FrameTime: 0,
            meanCpuTime: 0,
            meanGpuTime: 0
        };
    }

    // --- Timers ---
    startInitTimer() {
        this.initStartTime = performance.now();
    }

    endInitTimer() {
        this.results.initTime = performance.now() - this.initStartTime;
        this.initialized = true;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.uiStatus.textContent = "Warming Up...";
        this.uiStatus.style.color = "#f39c12";
        console.log(`Initialization complete in ${this.results.initTime.toFixed(2)}ms`);
    }

    // --- WebGPU Timestamps Setup ---
    async initWebGPUTimestamps(device) {
        this.device = device;
        if (this.device.features.has('timestamp-query')) {
            this.gpuSupportTimestamp = true;
            this.gpuQuerySet = this.device.createQuerySet({
                type: 'timestamp',
                count: 2, // 0: start, 1: end
            });
            this.gpuResolveBuffer = this.device.createBuffer({
                size: 2 * 8, // 2 timestamps, 8 bytes (uint64) each
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            });
            this.gpuResultBuffer = this.device.createBuffer({
                size: 2 * 8,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        } else {
            console.warn("timestamp-query feature is not supported on this device/browser.");
            this.gpuSupportTimestamp = false;
        }
    }

    beginGPUTimestamp(commandEncoder) {
        if (!this.gpuSupportTimestamp || this.isWarmingUp || this.isComplete) return;
        commandEncoder.writeTimestamp(this.gpuQuerySet, 0);
    }

    endGPUTimestamp(commandEncoder) {
        if (!this.gpuSupportTimestamp || this.isWarmingUp || this.isComplete) return;
        commandEncoder.writeTimestamp(this.gpuQuerySet, 1);
        commandEncoder.resolveQuerySet(this.gpuQuerySet, 0, 2, this.gpuResolveBuffer, 0);
        commandEncoder.copyBufferToBuffer(this.gpuResolveBuffer, 0, this.gpuResultBuffer, 0, 16);
    }

    async resolveGPUTimestamp() {
        if (!this.gpuSupportTimestamp || this.isWarmingUp || this.isComplete) return -1;

        await this.gpuResultBuffer.mapAsync(GPUMapMode.READ);
        const arrayBuffer = this.gpuResultBuffer.getMappedRange();
        const timestamps = new BigInt64Array(arrayBuffer);

        const start = Number(timestamps[0]);
        const end = Number(timestamps[1]);

        this.gpuResultBuffer.unmap();

        // Convert nanoseconds to milliseconds
        const durationMs = (end - start) / 1e6;
        if (durationMs >= 0) {
            this.results.gpuTimes.push(durationMs);
        }
        return durationMs;
    }

    // --- Per Frame API ---
    startFrame() {
        if (this.isComplete) return;

        const now = performance.now();
        if (this.isWarmingUp) {
            if ((now - this.startTime) > this.warmupDuration) {
                console.log(`Warmup complete (${this.warmupFrameCount} frames dropped). Starting measurement...`);
                this.isWarmingUp = false;
                this.startTime = now;
                this.lastFrameTime = now;
                this.uiStatus.textContent = "Recording";
                this.uiStatus.style.color = "#69db7c";
                this.activeFrameCount = 0;
            } else {
                this.warmupFrameCount++;
                return;
            }
        }

        performance.mark('frame-cpu-start');
    }

    endFrame() {
        if (this.isComplete || this.isWarmingUp) {
            this.lastFrameTime = performance.now();
            return;
        }

        performance.mark('frame-cpu-end');
        let cpuTime = 0;
        try {
            performance.measure('frame-cpu', 'frame-cpu-start', 'frame-cpu-end');
            const measures = performance.getEntriesByName('frame-cpu');
            cpuTime = measures[measures.length - 1].duration;
            performance.clearMeasures('frame-cpu');
        } catch (e) {
            // First frame might not have a start mark yet due to warmup exit.
        }

        performance.clearMarks('frame-cpu-start');
        performance.clearMarks('frame-cpu-end');

        const now = performance.now();
        const duration = now - this.lastFrameTime;

        this.results.frames.push(duration);
        this.results.cpuTimes.push(cpuTime);

        this.lastFrameTime = now;
        this.activeFrameCount++;

        // Update UI
        this.uiAccumulator += duration;
        this.uiFrameCount++;
        if (this.uiFrameCount >= 10) {
            const avgFrameTime = this.uiAccumulator / this.uiFrameCount;
            const currentFps = 1000 / avgFrameTime;
            this.uiFps.textContent = currentFps.toFixed(1);
            this.uiFrameTime.textContent = avgFrameTime.toFixed(2) + " ms";
            this.uiAccumulator = 0;
            this.uiFrameCount = 0;
        }

        this.checkCompletion(now);
    }

    checkCompletion(now) {
        let complete = false;

        if (this.durationMode === 'time') {
            if ((now - this.startTime) > this.targetDuration * 1000) {
                complete = true;
            }
        } else if (this.durationMode === 'frames') {
            if (this.activeFrameCount >= this.targetFrames) {
                complete = true;
            }
        }

        if (complete) {
            this.isComplete = true;
            this.finalizeResults(now);
        }
    }

    calculateStatistics() {
        const sum = arr => arr.reduce((a, b) => a + b, 0);
        const mean = arr => sum(arr) / arr.length;

        const variance = (arr, m) => arr.reduce((acc, val) => acc + Math.pow(val - m, 2), 0) / arr.length;
        const stdDev = arr => Math.sqrt(variance(arr, mean(arr)));

        const p95 = arr => {
            const sorted = [...arr].sort((a, b) => a - b);
            const idx = Math.floor(sorted.length * 0.95);
            return sorted[idx];
        };

        if (this.results.frames.length > 0) {
            this.results.meanFrameTime = mean(this.results.frames);
            this.results.stdFrameTime = stdDev(this.results.frames);
            this.results.p95FrameTime = p95(this.results.frames);
            this.results.fps = 1000 / this.results.meanFrameTime;
        }

        if (this.results.cpuTimes.length > 0) {
            this.results.meanCpuTime = mean(this.results.cpuTimes);
        }

        if (this.results.gpuTimes.length > 0) {
            this.results.meanGpuTime = mean(this.results.gpuTimes);
        }
    }

    finalizeResults(now) {
        this.results.totalTime = now - this.startTime;
        this.calculateStatistics();

        this.uiStatus.textContent = "Complete";
        this.uiStatus.style.color = "#4db8ff";

        window.__BENCHMARK_RESULTS__ = this.results;
        console.log("Benchmark Complete", this.results);
        window.dispatchEvent(new CustomEvent('benchmark-complete', { detail: this.results }));
    }

    reportError(message) {
        console.error("Benchmark Error:", message);
        document.getElementById('error-overlay').style.display = 'flex';
        document.getElementById('error-overlay').textContent = message;
        window.__BENCHMARK_ERROR__ = message;
    }
}
