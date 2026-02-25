import { Scenario } from '../scenarios/Scenario.js';
import { mat4, CubeData } from '../shared/math.js';

const vsSource = `#version 300 es
layout(location = 0) in vec3 aVertexPosition;
layout(location = 1) in vec3 aVertexNormal;
layout(location = 2) in mat4 aInstanceMatrix; // Takes locations 2, 3, 4, 5

uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;

out vec3 vNormal;

void main() {
    mat4 modelViewMatrix = uViewMatrix * aInstanceMatrix;
    gl_Position = uProjectionMatrix * modelViewMatrix * vec4(aVertexPosition, 1.0);
    
    // For uniforms scaling it's fine to just take upper 3x3 if uniform scale
    vNormal = mat3(modelViewMatrix) * aVertexNormal;
}
`;

const fsSource = `#version 300 es
precision highp float;

in vec3 vNormal;
out vec4 fragColor;

const vec3 lightDirection = normalize(vec3(0.5, 0.7, 1.0));
const vec3 ambientLight = vec3(0.2, 0.2, 0.2);
const vec3 diffuseLight = vec3(0.8, 0.8, 0.8);

void main() {
    vec3 normal = normalize(vNormal);
    float directional = max(dot(normal, lightDirection), 0.0);
    vec3 lighting = ambientLight + (directional * diffuseLight);
    
    vec3 baseColor = vec3(0.3, 0.8, 0.4);
    fragColor = vec4(baseColor * lighting, 1.0);
}
`;

export default class ScenarioB_WebGL extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);
        this.gl = canvas.getContext('webgl2');
        if (!this.gl) throw new Error('WebGL 2 not supported');

        this.program = null;
        this.vao = null;
        this.instanceBuffer = null;
        this.instanceData = null;

        this.projectionMatrix = mat4.create();
        this.viewMatrix = mat4.create();
        this.rotation = 0;
    }

    async init() {
        const gl = this.gl;

        this.program = this.createProgram(gl, vsSource, fsSource);
        gl.useProgram(this.program);

        this.uniforms = {
            uProjectionMatrix: gl.getUniformLocation(this.program, 'uProjectionMatrix'),
            uViewMatrix: gl.getUniformLocation(this.program, 'uViewMatrix'),
        };

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, CubeData.positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        const normalBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, CubeData.normals, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, CubeData.indices, gl.STATIC_DRAW);

        // Instance buffer (mat4 per instance)
        this.instanceData = new Float32Array(this.count * 16);
        this.instanceBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

        for (let i = 0; i < 4; i++) {
            const loc = 2 + i;
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, i * 16);
            gl.vertexAttribDivisor(loc, 1); // Instanced
        }

        gl.bindVertexArray(null);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0.1, 0.1, 0.1, 1.0);

        this.resize(this.canvas.width, this.canvas.height);

        // Setup initial static positions for instances
        this.instanceTransforms = [];
        const gridSize = Math.ceil(Math.pow(this.count, 1 / 3));
        const spacing = 3.0;
        let index = 0;
        for (let x = 0; x < gridSize; x++) {
            for (let y = 0; y < gridSize; y++) {
                for (let z = 0; z < gridSize; z++) {
                    if (index >= this.count) break;
                    this.instanceTransforms.push([
                        (x - gridSize / 2) * spacing,
                        (y - gridSize / 2) * spacing,
                        (z - gridSize / 2) * spacing
                    ]);
                    index++;
                }
            }
        }
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

        this.rotation += 0.01;
        mat4.identity(this.viewMatrix);
        const distance = Math.pow(this.count, 1 / 3) * 4.0;
        mat4.translate(this.viewMatrix, this.viewMatrix, [0.0, 0.0, -distance]);
        mat4.rotateX(this.viewMatrix, this.viewMatrix, this.rotation * 0.5);
        mat4.rotateY(this.viewMatrix, this.viewMatrix, this.rotation * 0.3);

        gl.uniformMatrix4fv(this.uniforms.uProjectionMatrix, false, this.projectionMatrix);
        gl.uniformMatrix4fv(this.uniforms.uViewMatrix, false, this.viewMatrix);

        // Update instance data
        for (let i = 0; i < this.count; i++) {
            const offset = i * 16;
            const pos = this.instanceTransforms[i];

            // Build simple translation + rotation matrix
            let tmp = mat4.create();
            mat4.translate(tmp, tmp, pos);
            mat4.rotateX(tmp, tmp, this.rotation + i);
            mat4.rotateY(tmp, tmp, this.rotation + i * 0.5);

            this.instanceData.set(tmp, offset);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData);

        gl.drawElementsInstanced(gl.TRIANGLES, CubeData.indices.length, gl.UNSIGNED_SHORT, 0, this.count);
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
