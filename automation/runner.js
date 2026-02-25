const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = 3000;
const HOST = `http://localhost:${PORT}`;

// Settings for Academic Runs
const NUM_RUNS = 10;

// Serve the app for Puppeteer
const app = express();
app.use(express.static(path.join(__dirname, '..')));
const server = app.listen(PORT);

const apis = ['webgl', 'webgpu'];
const testMatrix = [
    { scenario: 'A', counts: [1] },
    { scenario: 'B', counts: [100, 500, 1000, 5000, 10000] },
    { scenario: 'C', counts: [10000, 50000, 100000, 200000] },
    { scenario: 'D', counts: [100, 256, 512, 1024] },
    { scenario: 'E', counts: [500, 2000, 5000, 10000] } // State change stress
];

// Helper for statistics
const getMean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const getStdDev = (arr, mean) => Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / arr.length);
const getP95 = arr => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
};

async function runBenchmark() {
    console.log("Starting Academic Benchmark Suite...");

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--enable-unsafe-webgpu',
            '--disable-gpu-vsync',      // Uncapped FPS
            '--disable-frame-rate-limit',
            '--window-size=1280,720'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Attempt extract basic metadata from the browser
    const metadata = {
        userAgent: await browser.userAgent(),
        resolution: "1280x720",
        date: new Date().toISOString()
    };

    page.on('console', msg => {
        if (msg.type() === 'error') console.error('BROWSER ERROR:', msg.text());
    });

    const finalResults = {
        metadata: metadata,
        data: []
    };

    for (const api of apis) {
        for (const test of testMatrix) {
            for (const count of test.counts) {
                console.log(`\n=== Running: ${api.toUpperCase()} | Scenario ${test.scenario} | Count: ${count} ===`);

                const currentTestRuns = [];

                for (let run = 1; run <= NUM_RUNS; run++) {
                    const url = `${HOST}/index.html?api=${api}&scenario=${test.scenario}&count=${count}`;
                    await page.goto(url, { waitUntil: 'load' });

                    try {
                        const result = await page.evaluate(() => {
                            return new Promise((resolve, reject) => {
                                const to = setTimeout(() => reject("Timeout (120s)"), 120000);

                                window.addEventListener('benchmark-complete', (e) => {
                                    clearTimeout(to);
                                    resolve(e.detail);
                                });

                                if (window.__BENCHMARK_ERROR__) {
                                    clearTimeout(to);
                                    reject(window.__BENCHMARK_ERROR__);
                                }

                                if (window.__BENCHMARK_RESULTS__) {
                                    clearTimeout(to);
                                    resolve(window.__BENCHMARK_RESULTS__);
                                }
                            });
                        });

                        process.stdout.write(` [Run ${run}/${NUM_RUNS} ✔] `);
                        currentTestRuns.push({
                            fps: result.fps,
                            meanFrameTime: result.meanFrameTime,
                            stdFrameTime: result.stdFrameTime,
                            p95FrameTime: result.p95FrameTime,
                            meanCpuTime: result.meanCpuTime,
                            meanGpuTime: result.meanGpuTime || 0, // 0 for WebGL
                            initTime: result.initTime
                        });

                    } catch (e) {
                        console.error(`\nFailed Run ${run}: ${e}`);
                    }
                } // End 10 Runs

                if (currentTestRuns.length > 0) {
                    // Aggregate the 10 runs
                    const agg = {
                        api,
                        scenario: test.scenario,
                        count,
                        runsSuccessful: currentTestRuns.length,

                        meanFps: getMean(currentTestRuns.map(r => r.fps)),
                        stdFps: getStdDev(currentTestRuns.map(r => r.fps), getMean(currentTestRuns.map(r => r.fps))),

                        meanFrameTime: getMean(currentTestRuns.map(r => r.meanFrameTime)),
                        stdFrameTime: getStdDev(currentTestRuns.map(r => r.meanFrameTime), getMean(currentTestRuns.map(r => r.meanFrameTime))),

                        meanP95FrameTime: getMean(currentTestRuns.map(r => r.p95FrameTime)),
                        meanCpuTime: getMean(currentTestRuns.map(r => r.meanCpuTime)),
                        meanGpuTime: getMean(currentTestRuns.map(r => r.meanGpuTime)),

                        meanInitTime: getMean(currentTestRuns.map(r => r.initTime))
                    };

                    console.log(`\n--> Final Mean FPS: ${agg.meanFps.toFixed(2)} (±${agg.stdFps.toFixed(2)}) | Frame Time: ${agg.meanFrameTime.toFixed(2)}ms (±${agg.stdFrameTime.toFixed(2)})`);
                    finalResults.data.push(agg);
                } else {
                    finalResults.data.push({ api, scenario: test.scenario, count, error: "All runs failed" });
                }
            }
        }
    }

    await browser.close();
    server.close();

    console.log("\nSaving Academic Results...");

    const resultsDir = path.join(__dirname, '..', 'results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

    // Save JSON
    fs.writeFileSync(path.join(resultsDir, 'results.json'), JSON.stringify(finalResults, null, 2));

    // Save CSV
    let csv = "API,Scenario,Count,MeanFPS,StdFPS,MeanFrameTime_ms,StdFrameTime_ms,P95FrameTime_ms,MeanCpuTime_ms,MeanGpuTime_ms,MeanInitTime_ms,Error\n";
    finalResults.data.forEach(r => {
        if (r.error) {
            csv += `${r.api},${r.scenario},${r.count},,,,,,,,,${r.error}\n`;
        } else {
            csv += `${r.api},${r.scenario},${r.count},${r.meanFps.toFixed(2)},${r.stdFps.toFixed(2)},${r.meanFrameTime.toFixed(2)},${r.stdFrameTime.toFixed(2)},${r.meanP95FrameTime.toFixed(2)},${r.meanCpuTime.toFixed(2)},${r.meanGpuTime.toFixed(2)},${r.meanInitTime.toFixed(2)},\n`;
        }
    });
    fs.writeFileSync(path.join(resultsDir, 'results.csv'), csv);

    console.log("Done! Results saved to /results/");
}

runBenchmark().catch(err => {
    console.error(err);
    process.exit(1);
});
