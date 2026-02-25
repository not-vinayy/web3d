export class BenchmarkHarness {
    constructor() {
        this.results = {
            frames: [],
            totalTime: 0,
            fps: 0,
            initTime: 0,
            gpuTimes: [], // for WebGPU if timestamp queries are supported
        };

        this.initialized = false;
        this.startTime = 0;
        this.lastFrameTime = 0;
        this.frameCount = 0;

        // Target benchmark duration in seconds
        this.durationMode = 'frames'; // 'time' or 'frames'
        this.targetDuration = 5;
        this.targetFrames = 500;
        this.isComplete = false;

        // For UI updates
        this.uiFps = document.getElementById('fps-value');
        this.uiFrameTime = document.getElementById('frametime-value');
        this.uiStatus = document.getElementById('status-value');

        // Accumulator for UI updates
        this.uiAccumulator = 0;
        this.uiFrameCount = 0;

        // For GPU timings WebGPU
        this.gpuQuerySet = null;
        this.gpuResolveBuffer = null;
        this.gpuResultBuffer = null;
    }

    startInitTimer() {
        this.initStartTime = performance.now();
    }

    endInitTimer() {
        this.results.initTime = performance.now() - this.initStartTime;
        this.initialized = true;
        this.uiStatus.textContent = "Running";
        this.uiStatus.style.color = "#69db7c";
        console.log(`Initialization complete in ${this.results.initTime.toFixed(2)}ms`);
    }

    startFrame() {
        if (this.isComplete) return;
        if (this.frameCount === 0) {
            this.startTime = performance.now();
            this.lastFrameTime = this.startTime;
        }
    }

    endFrame(gpuTimeMs = -1) {
        if (this.isComplete) return;

        const now = performance.now();
        const duration = now - this.lastFrameTime;

        // Ignore the very first frame's duration as it includes initial paint overhead
        if (this.frameCount > 0) {
            this.results.frames.push(duration);
            if (gpuTimeMs >= 0) {
                this.results.gpuTimes.push(gpuTimeMs);
            }
        }

        this.lastFrameTime = now;
        this.frameCount++;

        // Update UI every 10 frames
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
            if (this.frameCount >= this.targetFrames) {
                complete = true;
            }
        }

        if (complete) {
            this.isComplete = true;
            this.finalizeResults(now);
        }
    }

    finalizeResults(now) {
        this.results.totalTime = now - this.startTime;
        this.results.fps = (this.results.frames.length / this.results.totalTime) * 1000;

        this.uiStatus.textContent = "Complete";
        this.uiStatus.style.color = "#4db8ff";

        // Attach to window object for Puppeteer to read
        window.__BENCHMARK_RESULTS__ = this.results;
        console.log("Benchmark Complete", this.results);

        // Dispatch event for UI
        window.dispatchEvent(new CustomEvent('benchmark-complete', { detail: this.results }));
    }

    reportError(message) {
        console.error("Benchmark Error:", message);
        document.getElementById('error-overlay').style.display = 'flex';
        document.getElementById('error-overlay').textContent = message;
        window.__BENCHMARK_ERROR__ = message;
    }
}
