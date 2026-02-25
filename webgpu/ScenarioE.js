import { Scenario } from '../scenarios/Scenario.js';
import { mat4, CubeData } from '../shared/math.js';

const wgslSource = `
struct GlobalUniforms {
    projectionMatrix : mat4x4<f32>,
    viewMatrix : mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> globalUbo : GlobalUniforms;

struct ObjectUniforms {
    modelMatrix : mat4x4<f32>,
    color : vec4<f32>,
}
@group(1) @binding(0) var<uniform> objectUbo : ObjectUniforms;

struct VertexInput {
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
}

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) normal : vec3<f32>,
}

@vertex
fn vs_main(in : VertexInput) -> VertexOutput {
    var out : VertexOutput;
    let mv = globalUbo.viewMatrix * objectUbo.modelMatrix;
    out.position = globalUbo.projectionMatrix * mv * vec4<f32>(in.position, 1.0);
    
    let nMat = mat3x3<f32>(mv[0].xyz, mv[1].xyz, mv[2].xyz);
    out.normal = nMat * in.normal;
    return out;
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
    let light = normalize(vec3<f32>(0.5, 0.7, 1.0));
    let dir = max(dot(normalize(in.normal), light), 0.2);
    return vec4<f32>(objectUbo.color.xyz * dir, 1.0);
}
`;

export default class ScenarioE_WebGPU extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);
        this.count = Math.min(this.count, 50000);
        this.format = navigator.gpu ? navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';
        this.rotation = 0;
        this.projectionMatrix = mat4.create();
    }

    async init() {
        if (!navigator.gpu) throw new Error('WebGPU not supported');

        this.adapter = await navigator.gpu.requestAdapter();
        this.device = await this.adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu');
        this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

        await this.harness.initWebGPUTimestamps(this.device);

        const vBuf = this.createBuffer(CubeData.positions, GPUBufferUsage.VERTEX);
        const nBuf = this.createBuffer(CubeData.normals, GPUBufferUsage.VERTEX);
        const iBuf = this.createBuffer(CubeData.indices, GPUBufferUsage.INDEX);
        this.buffers = { vBuf, nBuf, iBuf };

        // Global UBO
        this.globalUbo = this.device.createBuffer({
            size: 128, // 2x mat4
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const shaderModule = this.device.createShaderModule({ code: wgslSource });

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                    { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }
                ]
            },
            fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
            primitive: { topology: 'triangle-list', cullMode: 'back' },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' }
        });

        this.globalBindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.globalUbo } }]
        });

        // Generate N specific bind groups and buffers
        // This tests Bind Group switching overhead.
        this.objects = [];
        const gridSize = Math.ceil(Math.pow(this.count, 1 / 3));
        const spacing = 3.0;
        let index = 0;

        // Dynamic offsets are technically preferred, but for strictly simulating WebGL's terrible
        // multi-bind overhead, we will create many bind groups (up to device limits ofc).
        // For academic test, mapping 1:1 tests the command buffer encoding time.

        const uniformBindGroupLayout = this.pipeline.getBindGroupLayout(1);

        for (let x = 0; x < gridSize; x++) {
            for (let y = 0; y < gridSize; y++) {
                for (let z = 0; z < gridSize; z++) {
                    if (index >= this.count) break;

                    const ubo = this.device.createBuffer({
                        size: 80, // mat4 (64) + vec4 (16)
                        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                    });

                    const bindGroup = this.device.createBindGroup({
                        layout: uniformBindGroupLayout,
                        entries: [{ binding: 0, resource: { buffer: ubo } }]
                    });

                    this.objects.push({
                        pos: [(x - gridSize / 2) * spacing, (y - gridSize / 2) * spacing, (z - gridSize / 2) * spacing],
                        color: [Math.random(), Math.random(), Math.random(), 1.0],
                        ubo,
                        bindGroup
                    });
                    index++;
                }
            }
        }

        this.resize(this.canvas.width, this.canvas.height);
    }

    createBuffer(data, usage) {
        const buffer = this.device.createBuffer({
            size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST, mappedAtCreation: true,
        });
        if (data instanceof Float32Array) new Float32Array(buffer.getMappedRange()).set(data);
        else new Uint16Array(buffer.getMappedRange()).set(data);
        buffer.unmap();
        return buffer;
    }

    resize(width, height) {
        if (this.depthTex) this.depthTex.destroy();
        this.depthTex = this.device.createTexture({
            size: [width, height, 1], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthView = this.depthTex.createView();
        mat4.perspective(this.projectionMatrix, 45 * Math.PI / 180, width / height, 0.1, 1000.0, true);
    }

    async render() {
        this.rotation += 0.01;
        const view = mat4.create();
        const dist = Math.pow(this.count, 1 / 3) * 4.0;
        mat4.translate(view, view, [0, 0, -dist]);
        mat4.rotateX(view, view, this.rotation * 0.5);
        mat4.rotateY(view, view, this.rotation * 0.3);

        const globalData = new Float32Array(32);
        globalData.set(this.projectionMatrix, 0);
        globalData.set(view, 16);
        this.device.queue.writeBuffer(this.globalUbo, 0, globalData);

        // Update all object UBOs
        const model = mat4.create();
        for (let i = 0; i < this.count; i++) {
            const obj = this.objects[i];
            mat4.identity(model);
            mat4.translate(model, model, obj.pos);
            mat4.rotateX(model, model, this.rotation + i);
            mat4.rotateY(model, model, this.rotation + i * 0.5);

            const objData = new Float32Array(20);
            objData.set(model, 0);
            objData.set(obj.color, 16);

            this.device.queue.writeBuffer(obj.ubo, 0, objData);
        }

        const commandEncoder = this.device.createCommandEncoder();
        this.harness.beginGPUTimestamp(commandEncoder);

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 }, loadOp: 'clear', storeOp: 'store'
            }],
            depthStencilAttachment: {
                view: this.depthView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
            }
        });

        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, this.globalBindGroup);
        renderPass.setVertexBuffer(0, this.buffers.vBuf);
        renderPass.setVertexBuffer(1, this.buffers.nBuf);
        renderPass.setIndexBuffer(this.buffers.iBuf, 'uint16');

        // State changes per draw
        for (let i = 0; i < this.count; i++) {
            renderPass.setBindGroup(1, this.objects[i].bindGroup);
            renderPass.drawIndexed(CubeData.indices.length);
        }

        renderPass.end();

        this.harness.endGPUTimestamp(commandEncoder);

        this.device.queue.submit([commandEncoder.finish()]);
        return this.harness.resolveGPUTimestamp();
    }
}
