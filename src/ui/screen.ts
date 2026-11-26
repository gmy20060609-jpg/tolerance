// A photograph drawn as a line screen: parallel ink lines whose width follows
// the darkness of the picture under them, the way the grid's hatching follows
// a bet size. The pitch of the lines is the picture's tolerance: wide lines
// say little, fine ones say nearly everything.

import { h } from './dom.ts';
import { pixelRatio } from './theme.ts';

const VERTEX = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform vec2 size;     // canvas, device pixels
uniform vec2 cover;    // share of the picture shown along each axis
uniform vec2 focus;    // the point of the picture kept in view
uniform float pitch;   // device pixels from one line to the next
uniform float texels;  // picture pixels per device pixel
uniform vec3 ink;
uniform vec3 paper;
out vec4 color;

float dark(vec2 p, float lod) {
  vec2 uv = focus + (p / size - 0.5) * cover;
  vec3 c = textureLod(tex, clamp(uv, 0.0, 1.0), lod).rgb;
  return 1.0 - dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  vec2 n = vec2(0.70710678, 0.70710678);
  vec2 along = vec2(-n.y, n.x);
  float u = dot(p, n) / pitch;
  float f = fract(u) - 0.5;
  vec2 centre = p - n * f * pitch;
  float lod = max(0.0, log2(pitch * texels) - 1.0);
  float d = 0.5 * dark(centre, lod) + 0.25 * dark(centre + along * pitch * 0.5, lod) + 0.25 * dark(centre - along * pitch * 0.5, lod);
  d = clamp((d - 0.06) / 0.88, 0.0, 1.0);
  float halfWidth = 0.5 * d;
  float soft = 0.75 / pitch;
  float on = 1.0 - smoothstep(halfWidth - soft, halfWidth + soft, abs(f));
  color = vec4(mix(paper, ink, on * step(0.012, d)), 1.0);
}`;

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

export interface ScreenOptions {
  alt: string;
  /** The point of the picture that stays in view when it is cropped, 0 to 1 on each axis. */
  focus?: [number, number];
  ink?: string;
  paper?: string;
  /** Load the picture at once instead of when it nears the viewport. */
  eager?: boolean;
}

export class LineScreen {
  readonly el: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private ready = false;
  private value = 4;
  private readonly focus: [number, number];
  private readonly ink: [number, number, number];
  private readonly paper: [number, number, number];
  private pending = 0;

  constructor(src: string, options: ScreenOptions) {
    this.focus = options.focus ?? [0.5, 0.5];
    this.ink = rgb(options.ink ?? '#111110');
    this.paper = rgb(options.paper ?? '#f6f5f1');
    this.img = h('img', { src, alt: options.alt, decoding: 'async', loading: options.eager ? 'eager' : 'lazy' });
    this.img.style.objectPosition = `${this.focus[0] * 100}% ${this.focus[1] * 100}%`;
    this.canvas = h('canvas', { 'aria-hidden': 'true' });
    this.el = h('div.screen', this.img, this.canvas);
    if (this.img.complete && this.img.naturalWidth) this.start();
    else this.img.addEventListener('load', () => this.start(), { once: true });
    new ResizeObserver(() => this.draw()).observe(this.el);
  }

  /** Distance from one line to the next, in CSS pixels. */
  get pitch(): number {
    return this.value;
  }

  set pitch(value: number) {
    if (value === this.value) return;
    this.value = value;
    this.el.dataset.pitch = String(value);
    this.draw();
  }

  private start(): void {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return; // the photograph itself stays, in grey
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(program, 'a');
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.img);
    } catch {
      return;
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const name of ['tex', 'size', 'cover', 'focus', 'pitch', 'texels', 'ink', 'paper']) this.uniforms[name] = gl.getUniformLocation(program, name);
    this.gl = gl;
    this.ready = true;
    this.el.dataset.ready = 'true';
    this.canvas.addEventListener('webglcontextlost', () => {
      this.ready = false;
      delete this.el.dataset.ready;
    });
    this.draw();
  }

  private draw(): void {
    if (!this.ready || this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.paint();
    });
  }

  private paint(): void {
    const gl = this.gl;
    const box = this.el.getBoundingClientRect();
    if (!gl || !this.ready || box.width < 2 || box.height < 2) return;
    const dpr = Math.min(2, pixelRatio());
    const width = Math.round(box.width * dpr);
    const height = Math.round(box.height * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    // Crop like object-fit: cover, keeping the focus point in view.
    const iw = this.img.naturalWidth;
    const ih = this.img.naturalHeight;
    const scale = Math.max(width / iw, height / ih);
    const cover: [number, number] = [width / (iw * scale), height / (ih * scale)];
    const focus: [number, number] = [
      Math.min(1 - cover[0] / 2, Math.max(cover[0] / 2, this.focus[0])),
      Math.min(1 - cover[1] / 2, Math.max(cover[1] / 2, this.focus[1])),
    ];
    const u = this.uniforms;
    gl.uniform1i(u.tex!, 0);
    gl.uniform2f(u.size!, width, height);
    gl.uniform2f(u.cover!, cover[0], cover[1]);
    gl.uniform2f(u.focus!, focus[0], focus[1]);
    gl.uniform1f(u.pitch!, this.value * dpr);
    gl.uniform1f(u.texels!, 1 / scale);
    gl.uniform3f(u.ink!, ...this.ink);
    gl.uniform3f(u.paper!, ...this.paper);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
