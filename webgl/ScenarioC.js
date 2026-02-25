import { Scenario } from '../scenarios/Scenario.js';
import { mat4 } from '../shared/math.js';

const vsSource = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec4 aColor;

uniform mat4 uProjectionMatrix;

out vec4 vColor;

void main() {
    gl_Position = uProjectionMatrix * vec4(aPosition, 0.0, 1.0);
    gl_PointSize = 2.0;
    vColor = aColor;
}
`;

const fsSource = `#version 300 es
precision mediump float;

in vec4 vColor;
out vec4 fragColor;

void main() {
    // Soft circle
    vec2 coord = gl_PointCoord - vec2(0.5);
    if(length(coord) > 0.5)
        discard;
    fragColor = vColor;
}
`;

export default class ScenarioC_WebGL extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);
        this.gl = canvas.getContext('webgl2', { alpha: false });
        if (!this.gl) throw new Error('WebGL 2 not supported');

        // Cap count to reasonable CPU limit if someone enters 1M, CPU WebGL will die
        this.count = Math.min(this.count, 500000);

        this.program = null;
        this.vao = null;
        this.particleBuffer = null;

        // [x, y, vx, vy, r, g, b, a] per particle
        this.particleData = new Float32Array(this.count * 8);
        this.projectionMatrix = mat4.create();
    }

    async init() {
        const gl = this.gl;

        this.program = this.createProgram(gl, vsSource, fsSource);
        gl.useProgram(this.program);

        this.uProjectionMatrixLoc = gl.getUniformLocation(this.program, 'uProjectionMatrix');

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.particleBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);

        // Position
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);

        // Color
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);

        gl.bindVertexArray(null);

        // Initialize particles
        const w = this.canvas.width;
        const h = this.canvas.height;
        for (let i = 0; i < this.count; i++) {
            const idx = i * 8;
            this.particleData[idx] = Math.random() * w;     // x
            this.particleData[idx + 1] = Math.random() * h;   // y
            this.particleData[idx + 2] = (Math.random() - 0.5) * 2.0; // vx
            this.particleData[idx + 3] = (Math.random() - 0.5) * 2.0; // vy

            this.particleData[idx + 4] = Math.random() * 0.5 + 0.5; // r
            this.particleData[idx + 5] = Math.random() * 0.5 + 0.5; // g
            this.particleData[idx + 6] = 1.0;                       // b
            this.particleData[idx + 7] = 1.0;                       // a
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);

        this.resize(this.canvas.width, this.canvas.height);
    }

    resize(width, height) {
        this.gl.viewport(0, 0, width, height);
        // Orthographic projection for 2D particles
        const out = this.projectionMatrix;
        const left = 0, right = width, bottom = height, top = 0, near = -1, far = 1;
        out[0] = 2 / (right - left);
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        out[4] = 0;
        out[5] = 2 / (top - bottom);
        out[6] = 0;
        out[7] = 0;
        out[8] = 0;
        out[9] = 0;
        out[10] = -2 / (far - near);
        out[11] = 0;
        out[12] = -(right + left) / (right - left);
        out[13] = -(top + bottom) / (top - bottom);
        out[14] = -(far + near) / (far - near);
        out[15] = 1;
    }

    async render() {
        const gl = this.gl;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // CPU Physics update
        for (let i = 0; i < this.count; i++) {
            const idx = i * 8;
            let x = this.particleData[idx];
            let y = this.particleData[idx + 1];
            let vx = this.particleData[idx + 2];
            let vy = this.particleData[idx + 3];

            x += vx;
            y += vy;

            if (x < 0 || x > w) vx = -vx;
            if (y < 0 || y > h) vy = -vy;

            this.particleData[idx] = x;
            this.particleData[idx + 1] = y;
            this.particleData[idx + 2] = vx;
            this.particleData[idx + 3] = vy;
        }

        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);

        gl.uniformMatrix4fv(this.uProjectionMatrixLoc, false, this.projectionMatrix);

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData);

        gl.drawArrays(gl.POINTS, 0, this.count);
    }

    createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error('Shader compilation error: ' + gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    createProgram(gl, vsSource, fsSource) {
        const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
        }
        return program;
    }
}
