import { Scenario } from '../scenarios/Scenario.js';
import { mat4 } from '../shared/math.js';

const computeWGSL = `
struct Particle {
    pos : vec2<f32>,
    vel : vec2<f32>,
    color : vec4<f32>,
}
struct Particles {
    particles : array<Particle>,
}
struct Uniforms {
    width : f32,
    height : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(0) @binding(1) var<storage, read_write> particlesData : Particles;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
    let index = GlobalInvocationID.x;
    
    var p = particlesData.particles[index];
    p.pos = p.pos + p.vel;
    
    if (p.pos.x < 0.0 || p.pos.x > uniforms.width) {
        p.vel.x = -p.vel.x;
        p.pos.x = clamp(p.pos.x, 0.0, uniforms.width);
    }
    if (p.pos.y < 0.0 || p.pos.y > uniforms.height) {
        p.vel.y = -p.vel.y;
        p.pos.y = clamp(p.pos.y, 0.0, uniforms.height);
    }
    
    particlesData.particles[index] = p;
}
`;

const renderWGSL = `
struct Uniforms {
    projectionMatrix : mat4x4<f32>,
}
@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct Particle {
    pos : vec2<f32>,
    vel : vec2<f32>,
    color : vec4<f32>,
}
struct Particles {
    particles : array<Particle>,
}
@group(0) @binding(1) var<storage, read> particlesData : Particles;

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) color : vec4<f32>,
}

// Draw a quad instanced. 4 vertices per particle instance.
var<private> quad_pos : array<vec2<f32>, 4> = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
);

@vertex
fn vs_main(
    @builtin(vertex_index) vertexIndex : u32,
    @builtin(instance_index) instanceIndex : u32
) -> VertexOutput {
    let p = particlesData.particles[instanceIndex];
    let qpos = quad_pos[vertexIndex];
    
    // Scale particle quad (e.g. radius = 2.0 pixels)
    let particle_size = 2.0;
    let world_pos = p.pos + qpos * particle_size;
    
    var out : VertexOutput;
    out.position = uniforms.projectionMatrix * vec4<f32>(world_pos, 0.0, 1.0);
    out.color = p.color;
    return out;
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
    return in.color;
}
`;

export default class ScenarioC_WebGPU extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);
        this.format = navigator.gpu ? navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';

        this.particleBuffer = null;
        this.computePipeline = null;
        this.renderPipeline = null;
        this.computeBindGroup = null;
        this.renderBindGroup = null;

        this.computeUniforms = new Float32Array(2); // width, height
        this.computeUniformBuffer = null;

        this.projectionMatrix = mat4.create();
        this.renderUniformBuffer = null;

        this.workgroupCount = Math.ceil(this.count / 64);
    }

    async init() {
        if (!navigator.gpu) throw new Error('WebGPU not supported');

        this.adapter = await navigator.gpu.requestAdapter();
        this.device = await this.adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu');
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'opaque'
        });

        await this.harness.initWebGPUTimestamps(this.device);

        // Initialize particle data (32 bytes per particle: vec2 pos, vec2 vel, vec4 color)
        const initialData = new Float32Array(this.count * 8);
        const w = this.canvas.width;
        const h = this.canvas.height;
        for (let i = 0; i < this.count; i++) {
            const idx = i * 8;
            initialData[idx] = Math.random() * w;
            initialData[idx + 1] = Math.random() * h;
            initialData[idx + 2] = (Math.random() - 0.5) * 2.0;
            initialData[idx + 3] = (Math.random() - 0.5) * 2.0;
            initialData[idx + 4] = Math.random() * 0.5 + 0.5;
            initialData[idx + 5] = Math.random() * 0.5 + 0.5;
            initialData[idx + 6] = 1.0;
            initialData[idx + 7] = 1.0;
        }

        this.particleBuffer = this.device.createBuffer({
            size: initialData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(this.particleBuffer.getMappedRange()).set(initialData);
        this.particleBuffer.unmap();

        this.computeUniformBuffer = this.device.createBuffer({
            size: 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.renderUniformBuffer = this.device.createBuffer({
            size: 64, // mat4
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Compute Pipeline
        const computeModule = this.device.createShaderModule({ code: computeWGSL });
        this.computePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: computeModule, entryPoint: 'cs_main' }
        });

        this.computeBindGroup = this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.computeUniformBuffer } },
                { binding: 1, resource: { buffer: this.particleBuffer } }
            ]
        });

        // Render Pipeline
        const renderModule = this.device.createShaderModule({ code: renderWGSL });
        this.renderPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: renderModule, entryPoint: 'vs_main' },
            fragment: {
                module: renderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: this.format,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                        alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }
                    }
                }]
            },
            primitive: { topology: 'triangle-strip' },
        });

        this.renderBindGroup = this.device.createBindGroup({
            layout: this.renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.renderUniformBuffer } },
                { binding: 1, resource: { buffer: this.particleBuffer } }
            ]
        });

        this.resize(this.canvas.width, this.canvas.height);
    }

    resize(width, height) {
        this.computeUniforms[0] = width;
        this.computeUniforms[1] = height;
        this.device.queue.writeBuffer(this.computeUniformBuffer, 0, this.computeUniforms);

        const out = this.projectionMatrix;
        const left = 0, right = width, bottom = height, top = 0, near = -1, far = 1;
        out[0] = 2 / (right - left);
        out[1] = 0; out[2] = 0; out[3] = 0; out[4] = 0;
        out[5] = 2 / (top - bottom);
        out[6] = 0; out[7] = 0; out[8] = 0; out[9] = 0;
        out[10] = 1 / (near - far); // WebGPU coords
        out[11] = 0;
        out[12] = -(right + left) / (right - left);
        out[13] = -(top + bottom) / (top - bottom);
        out[14] = near / (near - far);
        out[15] = 1;

        this.device.queue.writeBuffer(this.renderUniformBuffer, 0, this.projectionMatrix);
    }

    async render() {
        const commandEncoder = this.device.createCommandEncoder();

        this.harness.beginGPUTimestamp(commandEncoder);

        // Compute pass
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.computeBindGroup);
        computePass.dispatchWorkgroups(this.workgroupCount);
        computePass.end();

        // Render pass
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });

        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.renderBindGroup);
        // Draw 4 vertices (quad) for each particle instance
        renderPass.draw(4, this.count, 0, 0);
        renderPass.end();

        this.harness.endGPUTimestamp(commandEncoder);

        this.device.queue.submit([commandEncoder.finish()]);

        return this.harness.resolveGPUTimestamp();
    }
}
