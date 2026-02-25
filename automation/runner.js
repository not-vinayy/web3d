const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = 3000;
const HOST = `http://localhost:${PORT}`;

// Serve the app for Puppeteer
const app = express();
app.use(express.static(path.join(__dirname, '..')));
const server = app.listen(PORT);

const apis = ['webgl', 'webgpu'];
const testMatrix = [
    { scenario: 'A', counts: [1] },
    { scenario: 'B', counts: [100, 500, 1000, 5000, 10000] },
    { scenario: 'C', counts: [10000, 50000, 100000, 200000] },
    { scenario: 'D', counts: [100, 256, 512, 1024] }
];

async function runBenchmark() {
    console.log("Starting Benchmark Suite...");

    // Launch browser with WebGPU enabled
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--enable-unsafe-webgpu',
            '--disable-gpu-vsync',      // To see true max FPS
            '--disable-frame-rate-limit',
            '--window-size=1280,720'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Route console logs
    page.on('console', msg => {
        if (msg.type() === 'error') console.error('BROWSER ERROR:', msg.text());
        // else console.log('BROWSER:', msg.text());
    });

    const allResults = [];

    for (const api of apis) {
        for (const test of testMatrix) {
            for (const count of test.counts) {
                console.log(`\n=== Running: ${api.toUpperCase()} | Scenario ${test.scenario} | Count: ${count} ===`);

                const url = `${HOST}/index.html?api=${api}&scenario=${test.scenario}&count=${count}`;
                await page.goto(url, { waitUntil: 'load' });

                try {
                    // Wait for the complete event dispatched by Harness
                    const result = await page.evaluate(() => {
                        return new Promise((resolve, reject) => {
                            // Timeout in case it hangs (e.g., 30 seconds)
                            const to = setTimeout(() => reject("Timeout"), 30000);

                            window.addEventListener('benchmark-complete', (e) => {
                                clearTimeout(to);
                                resolve(e.detail);
                            });

                            // Check if it already errored
                            if (window.__BENCHMARK_ERROR__) {
                                clearTimeout(to);
                                reject(window.__BENCHMARK_ERROR__);
                            }

                            // Check if it already finished before listener attached
                            if (window.__BENCHMARK_RESULTS__) {
                                clearTimeout(to);
                                resolve(window.__BENCHMARK_RESULTS__);
                            }
                        });
                    });

                    // Process result
                    const entry = {
                        api,
                        scenario: test.scenario,
                        count,
                        fps: result.fps,
                        avgFrameTime: result.frames.reduce((a, b) => a + b, 0) / result.frames.length,
                        initTime: result.initTime
                    };
                    allResults.push(entry);

                    console.log(`FPS: ${entry.fps.toFixed(2)} | Avg Frame Time: ${entry.avgFrameTime.toFixed(2)}ms | Init Time: ${entry.initTime.toFixed(2)}ms`);

                } catch (e) {
                    console.error(`Failed: ${api} - Scenario ${test.scenario} - Count ${count}: ${e}`);
                    allResults.push({
                        api,
                        scenario: test.scenario,
                        count,
                        fps: 0,
                        avgFrameTime: 0,
                        initTime: 0,
                        error: String(e)
                    });
                }
            }
        }
    }

    await browser.close();
    server.close();

    console.log("\nSaving Results...");

    const resultsDir = path.join(__dirname, '..', 'results');

    // Save JSON
    fs.writeFileSync(path.join(resultsDir, 'results.json'), JSON.stringify(allResults, null, 2));

    // Save CSV
    let csv = "API,Scenario,Count,FPS,AvgFrameTime_ms,InitTime_ms,Error\n";
    allResults.forEach(r => {
        csv += `${r.api},${r.scenario},${r.count},${(r.fps || 0).toFixed(2)},${(r.avgFrameTime || 0).toFixed(2)},${(r.initTime || 0).toFixed(2)},${r.error || ""}\n`;
    });
    fs.writeFileSync(path.join(resultsDir, 'results.csv'), csv);

    console.log("Done! Results saved to /results/");
}

runBenchmark().catch(err => {
    console.error(err);
    process.exit(1);
});
