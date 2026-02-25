# WebGL vs WebGPU Benchmarking Framework

A comprehensive, automated framework to benchmark rendering and compute capabilities across WebGL 2.0 and WebGPU APIs in the browser.

## Features

- **Four distinct benchmark scenarios**:
  - **Scenario A (Baseline)**: Single textured/colored rotating cube to measure baseline API overhead.
  - **Scenario B (Geometry Scaling)**: Draw 100 to 10,000 cubes utilizing instanced rendering to measure draw call / vertex scalability.
  - **Scenario C (Particle System)**: 10,000 to 200,000 particles simulated and rendered. WebGPU utilizes Compute Shaders for physics updates; WebGL uses CPU Float32Array updates.
  - **Scenario D (Compute Workload)**: Matrix Multiplication. WebGPU uses a native Compute Shader; WebGL simulates it via standard rendering to texture (GPGPU).
- **Automated Collection**: Puppeteer script runs the entire sequence matrix natively.
- **Reporting**: Generates structured `results.json` and `results.csv`.
- **Visualization**: Generates HTML/Chart.js graphs to view results interactively.

## Setup Requirements

- **Node.js** (v16+ recommended)
- **Chrome / Chromium Browser** (Puppeteer downloads a local Chromium binary automatically).
- A GPU that supports WebGPU.

## Installation

1. Clone or download this repository.
2. Open terminal in the project directory.
3. Run `npm install` to install dependencies (Express, Puppeteer, Chart.js).

## Running Benchmarks (Automated)

Run the full automated Puppeteer benchmark suite. Puppeteer will automatically launch Chrome with the necessary WebGPU flags (`--enable-unsafe-webgpu`).

\`\`\`bash
node automation/runner.js
\`\`\`

The script will:
1. Start a local Node.js Express server to host the files.
2. Launch a headless (or pseudo-headless) Chrome browser.
3. Automatically visit multiple scenarios varying `count` variables.
4. Export results to `results/results.json` and `results/results.csv`.

## Running Benchmarks (Manual/Visually)

Start the local server:
\`\`\`bash
node server.js
\`\`\`

Open your browser to: \`http://localhost:3000/?api=webgpu&scenario=B&count=5000\`

**Note on Manual WebGPU Testing:** 
Depending on your browser version, WebGPU might need to be explicitly enabled via flags.
- **Chrome/Edge**: Open \`chrome://flags\`, search for "Unsafe WebGPU", and enable it. 

## Viewing Results

After running the automated benchmark, you can visualize the data:
1. Ensure the web server is running (\`node server.js\`).
2. Navigate to \`http://localhost:3000/results/visualization/index.html\`.
3. The page will auto-load \`results.json\` and graph the performance data across tests.

## Architecture

* \`/metrics/Harness.js\` - Calculates FPS, Frame Variance, handles \`requestAnimationFrame\` hooks.
* \`/scenarios/Scenario.js\` - Base harness class handling initialization, sizing, and run loops.
* \`/webgl/*\` - WebGL 2.0 implementations.
* \`/webgpu/*\` - WebGPU WGSL and API implementations.
* \`/automation/runner.js\` - Puppeteer orchestra node script.
