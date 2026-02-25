import { Scenario } from '../scenarios/Scenario.js';
import { mat4, CubeData } from '../shared/math.js';

const vsSource = `#version 300 es
layout(location = 0) in vec3 aVertexPosition;
layout(location = 1) in vec3 aVertexNormal;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat3 uNormalMatrix;

out vec3 vNormal;

void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aVertexPosition, 1.0);
    vNormal = uNormalMatrix * aVertexNormal;
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
    
    // Base color for cube
    vec3 baseColor = vec3(0.3, 0.6, 1.0);
    fragColor = vec4(baseColor * lighting, 1.0);
}
`;

export default class ScenarioA_WebGL extends Scenario {
    constructor(canvas, harness) {
        super(canvas, harness);
        this.gl = canvas.getContext('webgl2');
        if (!this.gl) throw new Error('WebGL 2 not supported');

        this.program = null;
        this.vao = null;
        this.uniforms = {};

        this.projectionMatrix = mat4.create();
        this.modelViewMatrix = mat4.create();
        this.normalMatrix = new Float32Array(9);
        this.rotation = 0;
    }

    async init() {
        const gl = this.gl;

        // Compile shaders
        this.program = this.createProgram(gl, vsSource, fsSource);
        gl.useProgram(this.program);

        this.uniforms = {
            uProjectionMatrix: gl.getUniformLocation(this.program, 'uProjectionMatrix'),
            uModelViewMatrix: gl.getUniformLocation(this.program, 'uModelViewMatrix'),
            uNormalMatrix: gl.getUniformLocation(this.program, 'uNormalMatrix'),
        };

        // Create buffers and VAO
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

        gl.bindVertexArray(null);

        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0.1, 0.1, 0.1, 1.0);

        this.resize(this.canvas.width, this.canvas.height);
    }

    resize(width, height) {
        this.gl.viewport(0, 0, width, height);
        mat4.perspective(this.projectionMatrix, 45 * Math.PI / 180, width / height, 0.1, 100.0, false);
    }

    async render() {
        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        // Update matrices
        this.rotation += 0.01;
        mat4.identity(this.modelViewMatrix);
        mat4.translate(this.modelViewMatrix, this.modelViewMatrix, [0.0, 0.0, -5.0]);
        mat4.rotateX(this.modelViewMatrix, this.modelViewMatrix, this.rotation);
        mat4.rotateY(this.modelViewMatrix, this.modelViewMatrix, this.rotation * 0.7);

        // Calculate normal matrix (mat3) based on modelViewMatrix
        this.normalMatrix[0] = this.modelViewMatrix[0];
        this.normalMatrix[1] = this.modelViewMatrix[1];
        this.normalMatrix[2] = this.modelViewMatrix[2];
        this.normalMatrix[3] = this.modelViewMatrix[4];
        this.normalMatrix[4] = this.modelViewMatrix[5];
        this.normalMatrix[5] = this.modelViewMatrix[6];
        this.normalMatrix[6] = this.modelViewMatrix[8];
        this.normalMatrix[7] = this.modelViewMatrix[9];
        this.normalMatrix[8] = this.modelViewMatrix[10];

        gl.uniformMatrix4fv(this.uniforms.uProjectionMatrix, false, this.projectionMatrix);
        gl.uniformMatrix4fv(this.uniforms.uModelViewMatrix, false, this.modelViewMatrix);
        gl.uniformMatrix3fv(this.uniforms.uNormalMatrix, false, this.normalMatrix);

        gl.drawElements(gl.TRIANGLES, CubeData.indices.length, gl.UNSIGNED_SHORT, 0);
    }

    createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Shader compilation error: ' + info);
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
