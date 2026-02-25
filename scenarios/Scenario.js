export class Scenario {
    constructor(canvas, harness) {
        this.canvas = canvas;
        this.harness = harness;
        this.context = null;
        this.device = null; // WebGPU only
        this.gl = null;     // WebGL only

        // Scenario Parameters
        this.count = 100;
        this.isRunning = false;
        this.animationFrameId = null;
    }

    async init() {
        throw new Error("init() must be implemented by subclass");
    }

    async render() {
        throw new Error("render() must be implemented by subclass");
    }

    start() {
        this.isRunning = true;
        this.harness.endInitTimer();
        this.run();
    }

    run() {
        if (!this.isRunning) return;

        this.harness.startFrame();

        const renderPromise = this.render();

        if (renderPromise instanceof Promise) {
            renderPromise.then((gpuTimeMs) => {
                this.harness.endFrame(gpuTimeMs !== undefined ? gpuTimeMs : -1);
                this.animationFrameId = requestAnimationFrame(() => this.run());
            }).catch(err => {
                this.harness.reportError(err.message);
                this.stop();
            });
        } else {
            // WebGL usually is synchronous returning undefined
            this.harness.endFrame(-1);
            this.animationFrameId = requestAnimationFrame(() => this.run());
        }
    }

    stop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }
}
