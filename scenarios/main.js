import { BenchmarkHarness } from '../metrics/Harness.js';

const urlParams = new URLSearchParams(window.location.search);
const api = urlParams.get('api') || 'webgl';
const scenarioName = urlParams.get('scenario') || 'A';
const count = parseInt(urlParams.get('count') || '100', 10);

document.getElementById('api-label').textContent = api.toUpperCase();
document.getElementById('scenario-label').textContent = scenarioName;
document.getElementById('count-label').textContent = count;

const harness = new BenchmarkHarness();

async function loadScenario() {
    try {
        let ScenarioClass;

        if (api === 'webgl') {
            const module = await import(`../webgl/Scenario${scenarioName}.js`);
            ScenarioClass = module.default;
        } else if (api === 'webgpu') {
            const module = await import(`../webgpu/Scenario${scenarioName}.js`);
            ScenarioClass = module.default;
        } else {
            throw new Error(`Unknown API: ${api}`);
        }

        const canvas = document.getElementById('canvas');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const scenario = new ScenarioClass(canvas, harness);
        scenario.count = count;

        scenario.start();

        // Handle window resize
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            if (typeof scenario.resize === 'function') {
                scenario.resize(canvas.width, canvas.height);
            }
        });

    } catch (e) {
        harness.reportError(e.message || String(e));
        console.error(e);
    }
}

// Start loading the scenario
loadScenario();
