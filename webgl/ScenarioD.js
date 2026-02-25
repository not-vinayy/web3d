import { Scenario } from '../scenarios/Scenario.js';

const vsSource = `#version 300 es
layout(location = 0) in vec2 aPosition;
void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const fsSource = `#version 300 es
precision highp float;

uniform sampler2D uMatrixA;
uniform sampler2D uMatrixB;
uniform int uSize;

out vec4 fragColor;

void main() {
    ivec2 coord = ivec2(gl_FragCoord.xy); // x is col of B, y is row of A
    
    float sum = 0.0;
    for (int i = 0; i < uSize; i++) {
        // texelFetch uses integer coordinates (x, y, lod)
        float a = texelFetch(uMatrixA, ivec2(i, coord.y), 0).r;
        float b = texelFetch(uMatrixB, ivec2(coord.x, i), 0).r;
        sum += a * b;
    }
    
    fragColor = vec4(sum, 0.0, 0.0, 1.0);
}
`;

export default class ScenarioD_WebGL extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);
        this.gl = canvas.getContext('webgl2', { antialias: false });
        if (!this.gl) throw new Error('WebGL 2 not supported');

        // Ensure color_buffer_float is supported for GPGPU
        const ext = this.gl.getExtension('EXT_color_buffer_float');
        if (!ext) {
            console.warn("EXT_color_buffer_float not supported");
        }

        // Limit size to prevent freezing
        this.size = Math.min(Math.floor(Math.sqrt(this.count) * 10), 1024);
        if (this.size < 2) this.size = 2;

        this.program = null;
        this.vao = null;
        this.fbo = null;
        this.textureA = null;
        this.textureB = null;
        this.textureResult = null;
    }

    async init() {
        const gl = this.gl;

        this.program = this.createProgram(gl, vsSource, fsSource);
        gl.useProgram(this.program);

        this.uniforms = {
            uMatrixA: gl.getUniformLocation(this.program, 'uMatrixA'),
            uMatrixB: gl.getUniformLocation(this.program, 'uMatrixB'),
            uSize: gl.getUniformLocation(this.program, 'uSize'),
        };

        gl.uniform1i(this.uniforms.uMatrixA, 0);
        gl.uniform1i(this.uniforms.uMatrixB, 1);
        gl.uniform1i(this.uniforms.uSize, this.size);

        // Quad covering the screen
        const quadVertices = new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]);

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        // Create data (size x size matrices)
        const dataA = new Float32Array(this.size * this.size);
        const dataB = new Float32Array(this.size * this.size);
        for (let i = 0; i < this.size * this.size; i++) {
            dataA[i] = Math.random();
            dataB[i] = Math.random();
        }

        this.textureA = this.createFloatTexture(gl, this.size, dataA);
        this.textureB = this.createFloatTexture(gl, this.size, dataB);
        this.textureResult = this.createFloatTexture(gl, this.size, null);

        // Create Framebuffer
        this.fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textureResult, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.warn("Framebuffer not complete. GPGPU may fail.");
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    createFloatTexture(gl, size, data) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // Using R32F for single float channel
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, size, size, 0, gl.RED, gl.FLOAT, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    resize(width, height) {
        // Visual viewport doesn't matter much since we render to an offscreen FBO
        // but we'll render the FBO result to the screen for visual feedback
    }

    async render() {
        const gl = this.gl;

        // 1. Compute Pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, this.size, this.size);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textureA);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textureB);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Force execution. Real workloads would read back, 
        // but reading back `readPixels` every frame is extremely slow.
        // We simulate the workload by just rendering it.

        // 2. Display Pass (optional visual feedback)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // To be extremely minimal, we just clear the screen with a color here 
        // to show it's "running", since drawing the result texture is another shader.
    }

    createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
    }

    createProgram(gl, vsSource, fsSource) {
        const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        return program;
    }
}
