import { HAS, type Grid } from './grid';
import { CELL_RATIO, cellWidth, INK, inkStops, MONO_STACK, type FrameStyle, type GlassPanel, type IRenderer, type RenderStyle } from './render-common';

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec4 uClip; // x0, y0, x1, y1 in clip space
void main() {
  gl_Position = vec4(mix(uClip.xy, uClip.zw, aPos * 0.5 + 0.5), 0.0, 1.0);
}`;

/** Small 3x3 tent blur for the low-res light layers. */
const FS_BLUR = `#version 300 es
precision mediump float;
uniform sampler2D uSrc;
uniform vec2 uOut;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uOut;
  vec4 s = texture(uSrc, uv) * 0.25;
  s += (texture(uSrc, uv + vec2(uTexel.x, 0.)) + texture(uSrc, uv - vec2(uTexel.x, 0.)) +
        texture(uSrc, uv + vec2(0., uTexel.y)) + texture(uSrc, uv - vec2(0., uTexel.y))) * 0.125;
  s += (texture(uSrc, uv + uTexel) + texture(uSrc, uv - uTexel) +
        texture(uSrc, uv + vec2(uTexel.x, -uTexel.y)) + texture(uSrc, uv - vec2(uTexel.x, -uTexel.y))) * 0.0625;
  o = s;
}`;

/** The whole ASCII grid in one full-screen pass. */
const FS_SCENE = `#version 300 es
precision highp float;
uniform sampler2D uCellA;   // fg rgb + glyph slot
uniform sampler2D uCellB;   // bg rgb + flag (1 = tile, 0.5 = solid black)
uniform sampler2D uAtlas;   // glyph coverage in alpha
uniform sampler2D uBack;    // premultiplied, pre-blurred
uniform sampler2D uHaze;
uniform sampler2D uGlow;
uniform vec2 uRes;          // device px
uniform vec2 uCell;         // device px per cell
uniform vec2 uGrid;         // cols, rows
uniform vec2 uAtlasDim;     // slots per row, slot rows
uniform float uStopPos[8];
uniform vec3 uStopCol[8];
uniform int uNStops;
uniform float uInk;
uniform float uTime;
uniform float uFlash;
uniform float uGap;
uniform vec3 uLayers;
out vec4 o;

const vec3 INK = vec3(${INK.map((v) => (v / 255).toFixed(4)).join(', ')});

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 sky(float y) {
  vec3 c = uStopCol[0];
  for (int i = 1; i < 8; i++) {
    if (i >= uNStops) break;
    float a = uStopPos[i - 1];
    float b = uStopPos[i];
    c = mix(c, uStopCol[i], clamp((y - a) / max(b - a, 1e-4), 0.0, 1.0));
  }
  return c;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 cf = px / uCell;
  ivec2 c = ivec2(floor(cf));
  vec2 f = fract(cf);
  vec2 inCell = f * uCell;
  vec2 luv = px / (uGrid * uCell);
  bool ink = uInk > 0.5;

  vec3 col = sky(px.y / uRes.y);

  if (uLayers.x > 0.5) {
    vec4 b = texture(uBack, luv);
    col = col * (1.0 - b.a) + b.rgb;
  }
  if (ink && (inCell.x < 1.0 || inCell.y < 1.0)) col = mix(col, vec3(1.0), 0.045);

  vec4 B = texelFetch(uCellB, c, 0);
  if (B.a > 0.75) {
    vec3 tc = ink ? mix(B.rgb, INK, 0.34) : B.rgb;
    if (!ink || (inCell.x >= uGap && inCell.y >= uGap)) col = tc;
  } else if (B.a > 0.25) {
    col = vec3(0.0);
  }

  vec4 A = texelFetch(uCellA, c, 0);
  float slot = floor(A.a * 255.0 + 0.5);
  if (slot > 0.5) {
    vec2 s = vec2(mod(slot, uAtlasDim.x), floor(slot / uAtlasDim.x));
    vec2 au = (s + vec2((f.x + 0.5) * 0.5, f.y)) / uAtlasDim;
    float a = texture(uAtlas, au).a;
    vec3 fg = A.rgb;
    if (ink) {
      float L = dot(fg, vec3(0.2126, 0.7152, 0.0722));
      float minL = 112.0 / 255.0;
      if (L < minL) {
        float k = min(4.0, minL / max(L, 18.0 / 255.0));
        fg = fg * k + vec3(8.0, 10.0, 18.0) / 255.0;
      }
      float h = hash(vec2(c) + floor(uTime * 6.0) * vec2(17.0, 3.0));
      fg *= h < 0.1 ? 0.8 : (h > 0.9 ? 1.16 : 1.0);
    }
    col = mix(col, min(fg, vec3(1.0)), a);
  }

  if (uLayers.y > 0.5) {
    vec4 hz = texture(uHaze, luv);
    float k = ink ? 0.6 : 1.0;
    col = col * (1.0 - hz.a * k) + hz.rgb * k;
  }
  if (uLayers.z > 0.5) col += texture(uGlow, luv).rgb;
  col = mix(col, vec3(0.84, 0.886, 1.0), min(0.45, uFlash * 0.38));
  o = vec4(col, 1.0);
}`;

const FS_BLIT = `#version 300 es
precision mediump float;
uniform sampler2D uSrc;
uniform vec2 uRes;
out vec4 o;
void main() { o = texture(uSrc, gl_FragCoord.xy / uRes); }`;

/**
 * Liquid glass: refracts the live scene through a rounded slab. Light bends
 * hardest at the bevelled rim (with per-channel chromatic aberration), the
 * centre magnifies slightly, the slab is lightly frosted and lit from the
 * top-left.
 */
const FS_GLASS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform vec4 uRect;    // x, y (bottom-left, GL space), w, h — device px
uniform float uRadius;
uniform float uOpacity;
uniform float uDark;
uniform float uBlur;
uniform float uDpr;
out vec4 o;

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec3 tap(vec2 p) { return texture(uScene, clamp(p, vec2(0.5), uRes - 0.5) / uRes).rgb; }
vec3 frost(vec2 p, float r) {
  vec3 s = tap(p) * 0.2;
  s += (tap(p + vec2(r, 0.)) + tap(p - vec2(r, 0.)) + tap(p + vec2(0., r)) + tap(p - vec2(0., r))) * 0.12;
  float d = r * 0.7071;
  s += (tap(p + vec2(d, d)) + tap(p - vec2(d, d)) + tap(p + vec2(d, -d)) + tap(p - vec2(d, -d))) * 0.08;
  return s;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 hs = uRect.zw * 0.5;
  vec2 q = px - (uRect.xy + hs);
  float r = min(uRadius, min(hs.x, hs.y));
  float d = sdBox(q, hs, r);
  if (d > 1.0) discard;
  float aa = clamp(0.5 - d, 0.0, 1.0);

  vec2 n = vec2(sdBox(q + vec2(1., 0.), hs, r) - sdBox(q - vec2(1., 0.), hs, r),
                sdBox(q + vec2(0., 1.), hs, r) - sdBox(q - vec2(0., 1.), hs, r));
  n /= max(length(n), 1e-4);

  float bevel = max(4.0, min(min(hs.x, hs.y), 28.0 * uDpr));
  float t = clamp(-d / bevel, 0.0, 1.0);
  float edge = 1.0 - t;
  float bend = edge * edge * edge;

  // Refraction: the rim pulls in what lies beyond the edge; the centre magnifies.
  vec2 off = n * bend * bevel * 1.1 - q * 0.045 * t;
  float ca = 0.04 + 0.32 * bend;
  float br = uBlur * (0.7 + 0.6 * edge);
  vec3 col;
  col.r = frost(px + off * (1.0 + ca), br).r;
  col.g = frost(px + off, br).g;
  col.b = frost(px + off * (1.0 - ca), br).b;

  col = mix(col, vec3(0.012, 0.015, 0.028), uDark);

  vec2 L = normalize(vec2(-0.55, 0.85));
  float rim = smoothstep(2.2 * uDpr, 0.0, -d);
  float spec = pow(max(dot(n, L), 0.0), 2.0);
  float back = pow(max(dot(n, -L), 0.0), 3.0);
  col += rim * (0.05 + 0.55 * spec + 0.16 * back);
  col += vec3(0.75, 0.85, 1.0) * bend * 0.07;
  col += 0.03 * clamp(q.y / hs.y, 0.0, 1.0);
  o = vec4(col, aa * uOpacity);
}`;

// ---------------------------------------------------------------------------

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

/** Glyph atlas: each slot is two cells wide so wide (CJK) glyphs fit. */
class Atlas {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  readonly perRow = 32;
  readonly slotRows = 8;
  private map = new Int16Array(65536);
  private next = 1;
  dirty = true;
  slotW = 2;
  slotH = 1;

  build(cellW: number, cellH: number, fontPx: number): void {
    this.slotW = Math.ceil(cellW * 2);
    this.slotH = Math.ceil(cellH);
    this.canvas.width = this.slotW * this.perRow;
    this.canvas.height = this.slotH * this.slotRows;
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.font = `600 ${fontPx}px ${MONO_STACK}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#fff';
    this.map.fill(-1);
    this.map[32] = 0;
    this.map[0] = 0;
    this.next = 1;
    this.dirty = true;
  }

  slot(code: number): number {
    const m = this.map[code];
    if (m >= 0) return m;
    if (this.next >= this.perRow * this.slotRows) return (this.map[code] = this.slot(63)); // '?'
    const s = this.next++;
    const x = (s % this.perRow) * this.slotW;
    const y = Math.floor(s / this.perRow) * this.slotH;
    this.ctx.fillText(String.fromCharCode(code), x + this.slotW / 2, y + this.slotH / 2 + this.slotH * 0.02);
    this.dirty = true;
    return (this.map[code] = s);
  }
}

/** WebGL2 renderer: one GPU pass for the grid, one per liquid-glass panel. */
export class GLRenderer implements IRenderer {
  readonly kind = 'gl' as const;
  cols = 0;
  rows = 0;
  cw = 6;
  chh = 7;
  style: RenderStyle = 'ink';
  private dpr = 1;
  private W = 1;
  private H = 1;
  private scene: Prog;
  private blur: Prog;
  private blit: Prog;
  private glass: Prog;
  private atlas = new Atlas();
  private tex: Record<string, WebGLTexture> = {};
  private fbo: Record<string, WebGLFramebuffer> = {};
  private bufA = new Uint8Array(0);
  private bufB = new Uint8Array(0);
  private bufSoft = new Uint8Array(0);

  static create(canvas: HTMLCanvasElement): GLRenderer | null {
    try {
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
      return gl ? new GLRenderer(canvas, gl) : null;
    } catch {
      return null;
    }
  }

  private constructor(
    private canvas: HTMLCanvasElement,
    private gl: WebGL2RenderingContext,
  ) {
    this.scene = this.program(FS_SCENE);
    this.blur = this.program(FS_BLUR);
    this.blit = this.program(FS_BLIT);
    this.glass = this.program(FS_GLASS);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['A', 'B', 'atlas', 'back', 'haze', 'glow', 'backB', 'hazeB', 'glowB', 'scene']) this.tex[name] = gl.createTexture()!;
    for (const name of ['backB', 'hazeB', 'glowB', 'scene']) this.fbo[name] = gl.createFramebuffer()!;
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => location.reload());
  }

  get aspect(): number {
    return this.chh / this.cw;
  }

  private program(fs: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const u: Prog['u'] = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  private setupTex(t: WebGLTexture, w: number, h: number, linear: boolean): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private attach(fb: WebGLFramebuffer, t: WebGLTexture): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(density: number, style: RenderStyle): void {
    const gl = this.gl;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.style = style;
    this.cw = cellWidth(density);
    this.chh = Math.round(this.cw * CELL_RATIO);
    this.W = Math.round(w * this.dpr);
    this.H = Math.round(h * this.dpr);
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.cols = Math.ceil(w / this.cw);
    this.rows = Math.ceil(h / this.chh);
    const n = this.cols * this.rows;
    this.bufA = new Uint8Array(n * 4);
    this.bufB = new Uint8Array(n * 4);
    this.bufSoft = new Uint8Array(n * 4);
    this.setupTex(this.tex.A, this.cols, this.rows, false);
    this.setupTex(this.tex.B, this.cols, this.rows, false);
    for (const l of ['back', 'haze', 'glow']) {
      this.setupTex(this.tex[l], this.cols, this.rows, true);
      this.setupTex(this.tex[`${l}B`], this.cols * 2, this.rows * 2, true);
      this.attach(this.fbo[`${l}B`], this.tex[`${l}B`]);
    }
    this.setupTex(this.tex.scene, this.W, this.H, true);
    this.attach(this.fbo.scene, this.tex.scene);
    const cellW = this.cw * this.dpr;
    const cellH = this.chh * this.dpr;
    this.atlas.build(cellW, cellH, Math.round(this.chh * 0.74 * this.dpr));
    gl.bindTexture(gl.TEXTURE_2D, this.tex.atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private upload(t: WebGLTexture, data: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  /** Premultiply a float RGBA layer, upload it and blur it into its 2x target. */
  private softLayer(name: string, src: Float32Array, rgbOnly: boolean, toInk: number): void {
    const d = this.bufSoft;
    const k = toInk;
    if (rgbOnly) {
      for (let i = 0, j = 0; j < d.length; i += 3, j += 4) {
        d[j] = src[i];
        d[j + 1] = src[i + 1];
        d[j + 2] = src[i + 2];
        d[j + 3] = 255;
      }
    } else {
      for (let j = 0; j < d.length; j += 4) {
        const a = src[j + 3];
        d[j] = (src[j] * (1 - k) + INK[0] * k) * a;
        d[j + 1] = (src[j + 1] * (1 - k) + INK[1] * k) * a;
        d[j + 2] = (src[j + 2] * (1 - k) + INK[2] * k) * a;
        d[j + 3] = a * 255;
      }
    }
    this.upload(this.tex[name], d);
    const gl = this.gl;
    const b = this.blur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[`${name}B`]);
    gl.viewport(0, 0, this.cols * 2, this.rows * 2);
    gl.useProgram(b.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[name]);
    gl.uniform1i(b.u.uSrc, 0);
    gl.uniform2f(b.u.uOut, this.cols * 2, this.rows * 2);
    gl.uniform2f(b.u.uTexel, 1 / this.cols, 1 / this.rows);
    gl.uniform4f(b.u.uClip, -1, -1, 1, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render(g: Grid, f: FrameStyle): void {
    const gl = this.gl;
    const ink = this.style === 'ink';
    const n = g.n;
    const A = this.bufA;
    const B = this.bufB;
    const atlas = this.atlas;
    const ch = g.ch;
    const fg = g.fg;
    const bg = g.bg;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const code = ch[i];
      const c = fg[i];
      A[j] = (c >> 16) & 255;
      A[j + 1] = (c >> 8) & 255;
      A[j + 2] = c & 255;
      A[j + 3] = code === 32 || code === 0 ? 0 : atlas.slot(code);
      const v = bg[i];
      if (v & HAS) {
        const rgb = v & 0xffffff;
        B[j] = (rgb >> 16) & 255;
        B[j + 1] = (rgb >> 8) & 255;
        B[j + 2] = rgb & 255;
        B[j + 3] = rgb === 0 ? 128 : 255;
      } else B[j + 3] = 0;
    }
    this.upload(this.tex.A, A);
    this.upload(this.tex.B, B);
    if (atlas.dirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex.atlas);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      atlas.dirty = false;
    }
    if (g.usedBack) this.softLayer('back', g.back, false, ink ? 0.5 : 0);
    if (g.usedHaze) this.softLayer('haze', g.haze, false, ink ? 0.35 : 0);
    if (g.usedGlow) this.softLayer('glow', g.glow, true, 0);

    // Scene pass → offscreen texture.
    const s = this.scene;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.scene);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.BLEND);
    gl.useProgram(s.p);
    const bind = (unit: number, name: string, uniform: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[name]);
      gl.uniform1i(s.u[uniform], unit);
    };
    bind(0, 'A', 'uCellA');
    bind(1, 'B', 'uCellB');
    bind(2, 'atlas', 'uAtlas');
    bind(3, 'backB', 'uBack');
    bind(4, 'hazeB', 'uHaze');
    bind(5, 'glowB', 'uGlow');
    const stops = inkStops(f.stops, ink, f.skyInk ?? 1).slice(0, 8);
    const pos = new Float32Array(8);
    const cols = new Float32Array(24);
    stops.forEach(([o, c], i) => {
      pos[i] = o;
      cols[i * 3] = c[0] / 255;
      cols[i * 3 + 1] = c[1] / 255;
      cols[i * 3 + 2] = c[2] / 255;
    });
    gl.uniform1fv(s.u.uStopPos, pos);
    gl.uniform3fv(s.u.uStopCol, cols);
    gl.uniform1i(s.u.uNStops, stops.length);
    gl.uniform2f(s.u.uRes, this.W, this.H);
    gl.uniform2f(s.u.uCell, this.cw * this.dpr, this.chh * this.dpr);
    gl.uniform2f(s.u.uGrid, this.cols, this.rows);
    gl.uniform2f(s.u.uAtlasDim, atlas.perRow, atlas.slotRows);
    gl.uniform1f(s.u.uInk, ink ? 1 : 0);
    gl.uniform1f(s.u.uTime, f.t);
    gl.uniform1f(s.u.uFlash, f.flash);
    gl.uniform1f(s.u.uGap, Math.max(1, Math.round(this.dpr * 0.75)));
    gl.uniform3f(s.u.uLayers, g.usedBack ? 1 : 0, g.usedHaze ? 1 : 0, g.usedGlow ? 1 : 0);
    gl.uniform4f(s.u.uClip, -1, -1, 1, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Present.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(this.blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.scene);
    gl.uniform1i(this.blit.u.uSrc, 0);
    gl.uniform2f(this.blit.u.uRes, this.W, this.H);
    gl.uniform4f(this.blit.u.uClip, -1, -1, 1, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (f.panels?.length) this.drawGlass(f.panels);
  }

  private drawGlass(panels: GlassPanel[]): void {
    const gl = this.gl;
    const p = this.glass;
    const d = this.dpr;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(p.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.scene);
    gl.uniform1i(p.u.uScene, 0);
    gl.uniform2f(p.u.uRes, this.W, this.H);
    gl.uniform1f(p.u.uDpr, d);
    for (const g of panels) {
      if (g.opacity <= 0.01 || g.w < 2 || g.h < 2) continue;
      const x = g.x * d;
      const w = g.w * d;
      const h = g.h * d;
      const y = this.H - (g.y * d + h);
      // Quad covers the panel plus a pixel of anti-aliasing.
      const x0 = ((x - 2) / this.W) * 2 - 1;
      const x1 = ((x + w + 2) / this.W) * 2 - 1;
      const y0 = ((y - 2) / this.H) * 2 - 1;
      const y1 = ((y + h + 2) / this.H) * 2 - 1;
      gl.uniform4f(p.u.uClip, x0, y0, x1, y1);
      gl.uniform4f(p.u.uRect, x, y, w, h);
      gl.uniform1f(p.u.uRadius, g.radius * d);
      gl.uniform1f(p.u.uOpacity, g.opacity);
      gl.uniform1f(p.u.uDark, g.dark);
      gl.uniform1f(p.u.uBlur, g.blur * d);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
  }
}
