import { Scenario } from '../scenarios/Scenario.js';
import { mat4, CubeData } from '../shared/math.js';

const wgslSource = `
struct Uniforms {
    projectionMatrix : mat4x4<f32>,
    viewMatrix : mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexInput {
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
}

struct InstanceInput {
    @location(2) mat_0 : vec4<f32>,
    @location(3) mat_1 : vec4<f32>,
    @location(4) mat_2 : vec4<f32>,
    @location(5) mat_3 : vec4<f32>,
}

struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) normal : vec3<f32>,
}

@vertex
fn vs_main(in : VertexInput, instance : InstanceInput) -> VertexOutput {
    let instanceMatrix = mat4x4<f32>(
        instance.mat_0,
        instance.mat_1,
        instance.mat_2,
        instance.mat_3
    );

    let modelViewMatrix = uniforms.viewMatrix * instanceMatrix;
    
    var out : VertexOutput;
    out.position = uniforms.projectionMatrix * modelViewMatrix * vec4<f32>(in.position, 1.0);
    
    let nMat = mat3x3<f32>(
        modelViewMatrix[0].xyz,
        modelViewMatrix[1].xyz,
        modelViewMatrix[2].xyz
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
    
    let baseColor = vec3<f32>(0.3, 0.8, 0.4);
    return vec4<f32>(baseColor * lighting, 1.0);
}
`;

export default class ScenarioB_WebGPU extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);
        this.format = navigator.gpu ? navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';

        this.projectionMatrix = mat4.create();
        this.viewMatrix = mat4.create();
        this.uniformData = new Float32Array(32); // 2 mat4s
        this.rotation = 0;
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

        this.vertexBuffer = this.createBuffer(CubeData.positions, GPUBufferUsage.VERTEX);
        this.normalBuffer = this.createBuffer(CubeData.normals, GPUBufferUsage.VERTEX);
        this.indexBuffer = this.createBuffer(CubeData.indices, GPUBufferUsage.INDEX);

        this.uniformBuffer = this.device.createBuffer({
            size: this.uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.instanceData = new Float32Array(this.count * 16);
        this.instanceBuffer = this.device.createBuffer({
            size: this.instanceData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

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
                    },
                    {
                        arrayStride: 64,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 2, offset: 0, format: 'float32x4' },
                            { shaderLocation: 3, offset: 16, format: 'float32x4' },
                            { shaderLocation: 4, offset: 32, format: 'float32x4' },
                            { shaderLocation: 5, offset: 48, format: 'float32x4' }
                        ]
                    }
                ]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.format }]
            },
            primitive: { topology: 'triangle-list', cullMode: 'back' },
            depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' }
        });

        this.uniformBindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
        });

        this.resize(this.canvas.width, this.canvas.height);

        // Initial static positions
        this.instanceTransforms = [];
        const gridSize = Math.ceil(Math.pow(this.count, 1 / 3));
        const spacing = 3.0;
        let index = 0;
        for (let x = 0; x < gridSize; x++) {
            for (let y = 0; y < gridSize; y++) {
                for (let z = 0; z < gridSize; z++) {
                    if (index >= this.count) break;
                    this.instanceTransforms.push([(x - gridSize / 2) * spacing, (y - gridSize / 2) * spacing, (z - gridSize / 2) * spacing]);
                    index++;
                }
            }
        }
    }

    createBuffer(data, usage) {
        const buffer = this.device.createBuffer({
            size: data.byteLength,
            usage: usage | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        if (data instanceof Float32Array) new Float32Array(buffer.getMappedRange()).set(data);
        else new Uint16Array(buffer.getMappedRange()).set(data);
        buffer.unmap();
        return buffer;
    }

    resize(width, height) {
        if (this.depthTexture) this.depthTexture.destroy();
        this.depthTexture = this.device.createTexture({
            size: [width, height, 1],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthTextureView = this.depthTexture.createView();
        mat4.perspective(this.projectionMatrix, 45 * Math.PI / 180, width / height, 0.1, 1000.0, true);
    }

    async render() {
        this.rotation += 0.01;
        mat4.identity(this.viewMatrix);
        const distance = Math.pow(this.count, 1 / 3) * 4.0;
        mat4.translate(this.viewMatrix, this.viewMatrix, [0.0, 0.0, -distance]);
        mat4.rotateX(this.viewMatrix, this.viewMatrix, this.rotation * 0.5);
        mat4.rotateY(this.viewMatrix, this.viewMatrix, this.rotation * 0.3);

        this.uniformData.set(this.projectionMatrix, 0);
        this.uniformData.set(this.viewMatrix, 16);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

        for (let i = 0; i < this.count; i++) {
            const offset = i * 16;
            let tmp = mat4.create();
            mat4.translate(tmp, tmp, this.instanceTransforms[i]);
            mat4.rotateX(tmp, tmp, this.rotation + i);
            mat4.rotateY(tmp, tmp, this.rotation + i * 0.5);
            this.instanceData.set(tmp, offset);
        }

        this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData);

        const commandEncoder = this.device.createCommandEncoder();
        this.harness.beginGPUTimestamp(commandEncoder);

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
        renderPass.setVertexBuffer(2, this.instanceBuffer);
        renderPass.setIndexBuffer(this.indexBuffer, 'uint16');
        renderPass.drawIndexed(CubeData.indices.length, this.count);
        renderPass.end();

        this.harness.endGPUTimestamp(commandEncoder);

        this.device.queue.submit([commandEncoder.finish()]);

        return this.harness.resolveGPUTimestamp();
    }
}
