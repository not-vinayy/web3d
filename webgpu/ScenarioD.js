import { Scenario } from '../scenarios/Scenario.js';

const wgslSource = `
struct Matrix {
    size : vec2<f32>,
    numbers: array<f32>,
}

@group(0) @binding(0) var<storage, read> firstMatrix : Matrix;
@group(0) @binding(1) var<storage, read> secondMatrix : Matrix;
@group(0) @binding(2) var<storage, read_write> resultMatrix : Matrix;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    // global_id.x and global_id.y are column and row
    let resultCell = vec2<u32>(global_id.x, global_id.y);
    let sizeA = u32(firstMatrix.size.x); // width of A, height of B, which is size
    
    // Bounds check
    if (resultCell.x >= sizeA || resultCell.y >= sizeA) {
        return;
    }

    var result = 0.0;
    for (var i = 0u; i < sizeA; i = i + 1u) {
        let a = i + resultCell.y * sizeA;
        let b = resultCell.x + i * sizeA;
        result = result + firstMatrix.numbers[a] * secondMatrix.numbers[b];
    }
    
    let index = resultCell.y * sizeA + resultCell.x;
    resultMatrix.numbers[index] = result;
}
`;

export default class ScenarioD_WebGPU extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);

        this.size = Math.min(Math.floor(Math.sqrt(this.count) * 10), 1024);
        if (this.size < 2) this.size = 2;

        this.computePipeline = null;
        this.bindGroup = null;
        this.resultBuffer = null;
    }

    async init() {
        if (!navigator.gpu) throw new Error('WebGPU not supported');

        this.adapter = await navigator.gpu.requestAdapter();
        this.device = await this.adapter.requestDevice();

        // We only use Compute, no context/canvas configuring strictly needed
        // but let's clear it to black anyway.
        this.context = this.canvas.getContext('webgpu');
        this.context.configure({
            device: this.device,
            format: navigator.gpu.getPreferredCanvasFormat()
        });
        await this.harness.initWebGPUTimestamps(this.device);

        // 2 metadata floats (size) + size*size floats
        const elementCount = 2 + this.size * this.size;
        const byteSize = elementCount * 4;

        const firstMatrixData = new Float32Array(elementCount);
        firstMatrixData[0] = this.size;
        firstMatrixData[1] = this.size;
        for (let i = 2; i < elementCount; i++) firstMatrixData[i] = Math.random();

        const secondMatrixData = new Float32Array(elementCount);
        secondMatrixData[0] = this.size;
        secondMatrixData[1] = this.size;
        for (let i = 2; i < elementCount; i++) secondMatrixData[i] = Math.random();

        const gpuBufferFirstMatrix = this.device.createBuffer({
            mappedAtCreation: true,
            size: firstMatrixData.byteLength,
            usage: GPUBufferUsage.STORAGE
        });
        new Float32Array(gpuBufferFirstMatrix.getMappedRange()).set(firstMatrixData);
        gpuBufferFirstMatrix.unmap();

        const gpuBufferSecondMatrix = this.device.createBuffer({
            mappedAtCreation: true,
            size: secondMatrixData.byteLength,
            usage: GPUBufferUsage.STORAGE
        });
        new Float32Array(gpuBufferSecondMatrix.getMappedRange()).set(secondMatrixData);
        gpuBufferSecondMatrix.unmap();

        // Result buffer
        this.resultBuffer = this.device.createBuffer({
            size: byteSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const shaderModule = this.device.createShaderModule({ code: wgslSource });

        this.computePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'cs_main' }
        });

        this.bindGroup = this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: gpuBufferFirstMatrix } },
                { binding: 1, resource: { buffer: gpuBufferSecondMatrix } },
                { binding: 2, resource: { buffer: this.resultBuffer } }
            ]
        });

        this.workgroupCount = Math.ceil(this.size / 8);
    }

    async render() {
        const commandEncoder = this.device.createCommandEncoder();

        this.harness.beginGPUTimestamp(commandEncoder);

        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.computePipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.dispatchWorkgroups(this.workgroupCount, this.workgroupCount);
        passEncoder.end();

        // Small clear pass to give visual feedback
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.05, g: 0.05, b: 0.1, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        renderPass.end();

        this.harness.endGPUTimestamp(commandEncoder);

        this.device.queue.submit([commandEncoder.finish()]);

        return this.harness.resolveGPUTimestamp();
    }
}
