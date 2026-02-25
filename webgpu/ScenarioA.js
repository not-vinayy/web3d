import { Scenario } from '../scenarios/Scenario.js';
import { mat4, CubeData } from '../shared/math.js';

const wgslSource = `
struct Uniforms {
    projectionMatrix : mat4x4<f32>,
    modelViewMatrix : mat4x4<f32>,
    normalMatrix : mat4x4<f32>, // Pad to mat4 for simplicity in WGSL
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

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
    out.position = uniforms.projectionMatrix * uniforms.modelViewMatrix * vec4<f32>(in.position, 1.0);
    
    // Extract upper 3x3 for normal matrix
    let nMat = mat3x3<f32>(
        uniforms.normalMatrix[0].xyz,
        uniforms.normalMatrix[1].xyz,
        uniforms.normalMatrix[2].xyz
    );
    out.normal = nMat * in.normal;
    return out;
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
    let lightDirection = normalize(vec3<f32>(0.5, 0.7, 1.0));
    let ambientLight = vec3<f32>(0.2, 0.2, 0.2);
    let diffuseLight = vec3<f32>(0.8, 0.8, 0.8);
    
    let normal = normalize(in.normal);
    let directional = max(dot(normal, lightDirection), 0.0);
    let lighting = ambientLight + (directional * diffuseLight);
    
    let baseColor = vec3<f32>(0.3, 0.6, 1.0);
    return vec4<f32>(baseColor * lighting, 1.0);
}
`;

export default class ScenarioA_WebGPU extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);
        this.adapter = null;
        this.format = navigator.gpu ? navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';

        this.pipeline = null;
        this.uniformBuffer = null;
        this.uniformBindGroup = null;
        this.vertexBuffer = null;
        this.normalBuffer = null;
        this.indexBuffer = null;

        this.projectionMatrix = mat4.create();
        this.modelViewMatrix = mat4.create();
        this.uniformData = new Float32Array(16 * 3); // 3 mat4s
        this.rotation = 0;

        this.depthTexture = null;
        this.depthTextureView = null;
    }

    async init() {
        if (!navigator.gpu) throw new Error('WebGPU not supported');

        this.adapter = await navigator.gpu.requestAdapter();
        if (!this.adapter) throw new Error('No appropriate GPUAdapter found.');

        this.device = await this.adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu');
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'opaque'
        });

        // Create buffers
        this.vertexBuffer = this.createBuffer(CubeData.positions, GPUBufferUsage.VERTEX);
        this.normalBuffer = this.createBuffer(CubeData.normals, GPUBufferUsage.VERTEX);
        this.indexBuffer = this.createBuffer(CubeData.indices, GPUBufferUsage.INDEX);

        this.uniformBuffer = this.device.createBuffer({
            size: this.uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Pipeline
        const shaderModule = this.device.createShaderModule({ code: wgslSource });

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: 12,
                        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }]
                    },
                    {
                        arrayStride: 12,
                        attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }]
                    }
                ]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.format }]
            },
            primitive: {
                topology: 'triangle-list',
                cullMode: 'back'
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus'
            }
        });

        this.uniformBindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{
                binding: 0,
                resource: { buffer: this.uniformBuffer }
            }]
        });

        this.resize(this.canvas.width, this.canvas.height);
    }

    createBuffer(data, usage) {
        const buffer = this.device.createBuffer({
            size: data.byteLength,
            usage: usage | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        if (data instanceof Float32Array) {
            new Float32Array(buffer.getMappedRange()).set(data);
        } else if (data instanceof Uint16Array) {
            new Uint16Array(buffer.getMappedRange()).set(data);
        }
        buffer.unmap();
        return buffer;
    }

    resize(width, height) {
        // Recreate depth texture on resize
        if (this.depthTexture) this.depthTexture.destroy();

        this.depthTexture = this.device.createTexture({
            size: [width, height, 1],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthTextureView = this.depthTexture.createView();

        mat4.perspective(this.projectionMatrix, 45 * Math.PI / 180, width / height, 0.1, 100.0, true);
    }

    async render() {
        this.rotation += 0.01;
        mat4.identity(this.modelViewMatrix);
        mat4.translate(this.modelViewMatrix, this.modelViewMatrix, [0.0, 0.0, -5.0]);
        mat4.rotateX(this.modelViewMatrix, this.modelViewMatrix, this.rotation);
        mat4.rotateY(this.modelViewMatrix, this.modelViewMatrix, this.rotation * 0.7);

        // Fill uniform data
        this.uniformData.set(this.projectionMatrix, 0);
        this.uniformData.set(this.modelViewMatrix, 16);

        // normalMatrix mat4 padding
        this.uniformData[32] = this.modelViewMatrix[0];
        this.uniformData[33] = this.modelViewMatrix[1];
        this.uniformData[34] = this.modelViewMatrix[2];
        this.uniformData[35] = 0;
        this.uniformData[36] = this.modelViewMatrix[4];
        this.uniformData[37] = this.modelViewMatrix[5];
        this.uniformData[38] = this.modelViewMatrix[6];
        this.uniformData[39] = 0;
        this.uniformData[40] = this.modelViewMatrix[8];
        this.uniformData[41] = this.modelViewMatrix[9];
        this.uniformData[42] = this.modelViewMatrix[10];
        this.uniformData[43] = 0;

        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

        const commandEncoder = this.device.createCommandEncoder();
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            }
        });

        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, this.uniformBindGroup);
        renderPass.setVertexBuffer(0, this.vertexBuffer);
        renderPass.setVertexBuffer(1, this.normalBuffer);
        renderPass.setIndexBuffer(this.indexBuffer, 'uint16');
        renderPass.drawIndexed(CubeData.indices.length);
        renderPass.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }
}
