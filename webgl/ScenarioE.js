import { Scenario } from '../scenarios/Scenario.js';
import { mat4, CubeData } from '../shared/math.js';

const vsSource = `#version 300 es
layout(location = 0) in vec3 aVertexPosition;
layout(location = 1) in vec3 aVertexNormal;

uniform mat4 uProjectionMatrix;
uniform mat4 uModelViewMatrix;

out vec3 vNormal;

void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aVertexPosition, 1.0);
    vNormal = mat3(uModelViewMatrix) * aVertexNormal;
}
`;

const fsSource = `#version 300 es
precision highp float;

in vec3 vNormal;
out vec4 fragColor;

uniform vec3 uColor;

const vec3 lightDirection = normalize(vec3(0.5, 0.7, 1.0));

void main() {
    float directional = max(dot(normalize(vNormal), lightDirection), 0.2);
    fragColor = vec4(uColor * directional, 1.0);
}
`;

export default class ScenarioE_WebGL extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);
        this.gl = canvas.getContext('webgl2');
        if (!this.gl) throw new Error('WebGL 2 not supported');

        // Capping count because WebGL state changes are very slow
        this.count = Math.min(this.count, 50000);

        this.program = null;
        this.vao = null;
        this.projectionMatrix = mat4.create();

        this.objects = [];
        this.rotation = 0;
    }

    async init() {
        const gl = this.gl;

        this.program = this.createProgram(gl, vsSource, fsSource);
        gl.useProgram(this.program);

        this.uProjLoc = gl.getUniformLocation(this.program, 'uProjectionMatrix');
        this.uModelViewLoc = gl.getUniformLocation(this.program, 'uModelViewMatrix');
        this.uColorLoc = gl.getUniformLocation(this.program, 'uColor');

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, CubeData.positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        const normBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
        gl.bufferData(gl.ARRAY_BUFFER, CubeData.normals, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

        const idxBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, CubeData.indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);

        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0.1, 0.1, 0.1, 1.0);

        const gridSize = Math.ceil(Math.pow(this.count, 1 / 3));
        const spacing = 3.0;
        let index = 0;
        for (let x = 0; x < gridSize; x++) {
            for (let y = 0; y < gridSize; y++) {
                for (let z = 0; z < gridSize; z++) {
                    if (index >= this.count) break;
                    this.objects.push({
                        pos: [
                            (x - gridSize / 2) * spacing,
                            (y - gridSize / 2) * spacing,
                            (z - gridSize / 2) * spacing
                        ],
                        color: [Math.random(), Math.random(), Math.random()]
                    });
                    index++;
                }
            }
        }

        this.resize(this.canvas.width, this.canvas.height);
    }

    resize(width, height) {
        this.gl.viewport(0, 0, width, height);
        mat4.perspective(this.projectionMatrix, 45 * Math.PI / 180, width / height, 0.1, 1000.0, false);
    }

    async render() {
        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        gl.uniformMatrix4fv(this.uProjLoc, false, this.projectionMatrix);

        this.rotation += 0.01;
        const view = mat4.create();
        const dist = Math.pow(this.count, 1 / 3) * 4.0;
        mat4.translate(view, view, [0, 0, -dist]);
        mat4.rotateX(view, view, this.rotation * 0.5);
        mat4.rotateY(view, view, this.rotation * 0.3);

        const mv = mat4.create();

        // This loop simulates STATE CHANGE overhead.
        // It intentionally does NOT use instancing. Every object requires 2 uniform updates.
        for (let i = 0; i < this.count; i++) {
            const obj = this.objects[i];

            mat4.translate(mv, view, obj.pos);
            mat4.rotateX(mv, mv, this.rotation + i);
            mat4.rotateY(mv, mv, this.rotation + i * 0.5);

            gl.uniformMatrix4fv(this.uModelViewLoc, false, mv);
            gl.uniform3fv(this.uColorLoc, obj.color);

            gl.drawElements(gl.TRIANGLES, CubeData.indices.length, gl.UNSIGNED_SHORT, 0);
        }
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
        const p = gl.createProgram();
        gl.attachShader(p, vs); gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        return p;
    }
}
