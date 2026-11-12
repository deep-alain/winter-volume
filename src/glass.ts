import { SCENE_HEIGHT, SCENE_WIDTH, type WorldFrame } from './world';

export interface GlassFrame {
  position: number;
  stretch: number;
  angle: number;
  room: readonly number[];
  cursor: readonly [number, number, number, number];
}
export interface GlassRenderer {
  mode: 'webgl2' | 'canvas2d';
  resize(width: number, height: number): void;
  draw(world: WorldFrame, frame: GlassFrame): void;
  dispose(): void;
}

const vertex = `#version 300 es
precision highp float;
out vec2 uv;
void main(){
 vec2 p=vec2((gl_VertexID==1)?3.0:-1.0,(gl_VertexID==2)?3.0:-1.0);
 uv=(p+1.0)*0.5;gl_Position=vec4(p,0.0,1.0);
}`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D colorMap;
uniform sampler2D lightMap;
uniform sampler2D glowMap;
uniform float position;
uniform float stretch;
uniform float wobble;
uniform vec3 roomColor;
uniform vec4 cursor;
in vec2 uv;
out vec4 fragColor;

float roundBox(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return min(max(q.x,q.y),0.0)+length(max(q,0.0))-r;}
float track(vec2 p){return roundBox(p-vec2(48.0,88.0),vec2(38.0,72.0),38.0);}
vec4 pixel(sampler2D map,vec2 p){
 ivec2 q=ivec2(floor(p-vec2(10.0,16.0)));
 if(q.x<0||q.y<0||q.x>=76||q.y>=144)return vec4(0.0);
 return texelFetch(map,q,0);
}
vec3 glow(vec2 p){
 vec3 s=pixel(glowMap,p).rgb*0.25;
 s+=(pixel(glowMap,p+vec2(1.0,0.0)).rgb+pixel(glowMap,p-vec2(1.0,0.0)).rgb+pixel(glowMap,p+vec2(0.0,1.0)).rgb+pixel(glowMap,p-vec2(0.0,1.0)).rgb)*0.125;
 s+=(pixel(glowMap,p+vec2(2.0,2.0)).rgb+pixel(glowMap,p+vec2(-2.0,2.0)).rgb+pixel(glowMap,p+vec2(2.0,-2.0)).rgb+pixel(glowMap,p-vec2(2.0,2.0)).rgb)*0.0625;
 return s;
}
bool arrow(ivec2 q){return (q.y>=0&&q.y<10&&q.x>=0&&q.x<=q.y/2)||(q.y>=7&&q.y<14&&q.x>=3&&q.x<=4);}
void main(){
 vec2 p=vec2(uv.x,1.0-uv.y)*vec2(96.0,176.0);
 float aa=max(fwidth(p.y),0.24),d=track(p),inside=1.0-smoothstep(-aa,aa,d);
 vec2 center=vec2(48.0,134.0-92.0*position);
 float ca=cos(wobble),sa=sin(wobble);
 mat2 rotate=mat2(ca,-sa,sa,ca);
 vec2 local=rotate*(p-center);
 vec2 shaped=local*vec2(stretch,1.0/stretch);
 float lens=roundBox(shaped,vec2(28.0,34.0),28.0);
 float cover=1.0-smoothstep(-aa,aa,lens);
 float shadow=exp(-max(roundBox((p-center-vec2(2.0,5.0))*vec2(stretch,1.0/stretch),vec2(28.0,34.0),28.0),0.0)/3.4)*0.29;
 vec3 base=pixel(colorMap,p).rgb*(1.0-shadow)+glow(p)*0.48;
 float rim=exp(-abs(d)/0.8);
 base=mix(base,roomColor*0.7+vec3(0.26),rim*0.42);
 vec3 premul=base*inside;float alpha=inside;
 if(cover>0.0){
  vec2 normal=shaped/vec2(28.0,34.0);
  float edge=clamp(1.0+min(lens,0.0)/7.0,0.0,1.0);
  vec2 bent=center+transpose(rotate)*(local/1.28+normal*edge*2.8);
  vec2 split=normal*pow(edge,2.0)*1.65;
  vec3 refracted=vec3(pixel(lightMap,bent+split).r,pixel(lightMap,bent).g,pixel(lightMap,bent-split).b);
  refracted+=glow(bent)*0.3;
  float source=1.0-smoothstep(-aa,aa,track(bent));
  refracted*=1.0-0.24*exp(-pow((lens+3.0)/1.8,2.0));
  float fresnel=pow(clamp(length(normal),0.0,1.0),4.0);
  vec3 tint=mix(vec3(0.72,0.87,0.96),vec3(0.96,0.82,0.68),position);
  float streak=exp(-pow((local.x+14.0+local.y*0.09)/2.3,2.0))*exp(-pow((local.y+9.0)/22.0,4.0));
  float dotLight=exp(-dot((local-vec2(13.0,17.0))/2.5,(local-vec2(13.0,17.0))/2.5));
  float bright=exp(-abs(lens+0.3)/0.7);
  vec3 surface=mix(roomColor,tint,0.25);
  surface=mix(surface,refracted,source);
  surface+=tint*fresnel*0.15+vec3(streak*0.48+dotLight*0.66+bright*0.44);
  float a=cover*mix(0.18,1.0,source);
  premul=surface*a+premul*(1.0-a);alpha=a+alpha*(1.0-a);
 }
 if(cursor.z>0.5){
  ivec2 q=ivec2(floor(p-cursor.xy));
  bool inner=arrow(q),outline=inner;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)outline=outline||arrow(q+ivec2(x,y));
  if(outline){premul=inner?vec3(0.97,0.97,0.91):vec3(0.1,0.17,0.24);alpha=1.0;}
  float press=1.0-smoothstep(0.55,1.2,abs(length(p-cursor.xy)-7.0));
  float a=press*cursor.w*0.45;premul=vec3(0.98,0.88,0.65)*a+premul*(1.0-a);alpha=a+alpha*(1.0-a);
 }
 fragColor=vec4(premul,alpha);
}`;

function glRenderer(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): GlassRenderer {
  const shaders: WebGLShader[] = [];
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('无法创建玻璃着色器');
    shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? '玻璃着色器编译失败');
    return shader;
  };
  const program = gl.createProgram();
  if (!program) throw new Error('无法创建玻璃程序');
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? '玻璃程序链接失败');
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.useProgram(program);
  const textures = ['colorMap', 'lightMap', 'glowMap'].map((name, i) => {
    const texture = gl.createTexture();
    if (!texture) throw new Error('无法创建像素纹理');
    gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SCENE_WIDTH, SCENE_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.uniform1i(gl.getUniformLocation(program, name), i); return texture;
  });
  const location = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = { position: location('position'), stretch: location('stretch'), wobble: location('wobble'), room: location('roomColor'), cursor: location('cursor') };
  return {
    mode: 'webgl2',
    resize(width, height) { canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height); },
    draw(world, frame) {
      gl.useProgram(program); gl.bindVertexArray(vao);
      [world.color, world.lit, world.glow].forEach((pixels, i) => {
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, textures[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCENE_WIDTH, SCENE_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      });
      gl.uniform1f(uniforms.position, frame.position); gl.uniform1f(uniforms.stretch, frame.stretch); gl.uniform1f(uniforms.wobble, frame.angle);
      gl.uniform3fv(uniforms.room, frame.room); gl.uniform4fv(uniforms.cursor, frame.cursor);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { textures.forEach(t => gl.deleteTexture(t)); shaders.forEach(s => gl.deleteShader(s)); gl.deleteVertexArray(vao); gl.deleteProgram(program); },
  };
}

function fallbackRenderer(canvas: HTMLCanvasElement): GlassRenderer {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此浏览器无法创建画布');
  const source = document.createElement('canvas'); source.width = SCENE_WIDTH; source.height = SCENE_HEIGHT;
  const pixels = source.getContext('2d');
  if (!pixels) throw new Error('无法创建像素缓冲');
  const put = (buffer: Uint8Array) => { const data = pixels.createImageData(SCENE_WIDTH, SCENE_HEIGHT); data.data.set(buffer); pixels.putImageData(data, 0, 0); };
  return {
    mode: 'canvas2d',
    resize(width, height) { canvas.width = width; canvas.height = height; },
    draw(world, frame) {
      context.clearRect(0, 0, canvas.width, canvas.height); context.save(); context.scale(canvas.width / 96, canvas.height / 176); context.imageSmoothingEnabled = false;
      context.save(); context.beginPath(); context.roundRect(10, 16, 76, 144, 38); context.clip(); put(world.color); context.drawImage(source, 10, 16); context.restore();
      const y = 134 - frame.position * 92;
      context.save(); context.translate(48, y); context.rotate(frame.angle); context.scale(1 / frame.stretch, frame.stretch);
      context.beginPath(); context.roundRect(-28, -34, 56, 68, 28); context.clip();
      context.scale(frame.stretch, 1 / frame.stretch); context.rotate(-frame.angle); context.translate(-48, -y); put(world.lit);
      context.save(); context.beginPath(); context.roundRect(10, 16, 76, 144, 38); context.clip(); context.drawImage(source, 10, 16); context.restore(); context.restore();
      context.save(); context.translate(48, y); context.rotate(frame.angle); context.scale(1 / frame.stretch, frame.stretch);
      context.beginPath(); context.roundRect(-28, -34, 56, 68, 28); context.strokeStyle = '#e6f5f0bb'; context.lineWidth = 1.1; context.stroke(); context.restore();
      if (frame.cursor[2]) { context.fillStyle = '#fff8df'; context.strokeStyle = '#243b50'; context.lineWidth = 1; context.beginPath(); context.moveTo(frame.cursor[0], frame.cursor[1]); context.lineTo(frame.cursor[0] + 5, frame.cursor[1] + 9); context.lineTo(frame.cursor[0] + 3, frame.cursor[1] + 8); context.lineTo(frame.cursor[0] + 3, frame.cursor[1] + 13); context.lineTo(frame.cursor[0], frame.cursor[1]); context.fill(); context.stroke(); }
      context.restore();
    },
    dispose() { source.width = 0; source.height = 0; },
  };
}

export function createGlassRenderer(canvas: HTMLCanvasElement, forceFallback = false): GlassRenderer {
  // Fixed-time export seeks pause rAF; retain that frame for screenshots until the next draw.
  const gl = forceFallback ? null : canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
  return gl ? glRenderer(canvas, gl) : fallbackRenderer(canvas);
}
