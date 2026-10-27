import { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187, 0.366025403784439,
    -0.577350269189626, 0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
    permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
    0.5 - vec3(
      dot(x0, x0),
      dot(x12.xy, x12.xy),
      dot(x12.zw, x12.zw)
    ),
    0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) { \\
  int index = 0; \\
  for (int i = 0; i < 2; i++) { \\
    ColorStop currentColor = colors[i]; \\
    bool isInBetween = currentColor.position <= factor; \\
    index = int(mix(float(index), float(i), float(isInBetween))); \\
  } \\
  ColorStop currentColor = colors[index]; \\
  ColorStop nextColor = colors[index + 1]; \\
  float range = nextColor.position - currentColor.position; \\
  float lerpFactor = (factor - currentColor.position) / range; \\
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \\
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

export interface AuroraProps {
  colorStops?: string[];
  amplitude?: number;
  blend?: number;
  time?: number;
  speed?: number;
  className?: string;
  onUnavailable?: () => void;
}

/** React Bits Aurora — WebGL aurora background (via ogl). */
export default function Aurora({
  colorStops = ['#5227FF', '#7cff67', '#5227FF'],
  amplitude = 1.0,
  blend = 0.5,
  speed = 1.0,
  className = '',
  onUnavailable,
}: AuroraProps) {
  const propsRef = useRef({ colorStops, amplitude, blend, speed, onUnavailable });
  propsRef.current = { colorStops, amplitude, blend, speed, onUnavailable };

  const ctnDom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctn = ctnDom.current;
    if (!ctn) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
      });
    } catch (error) {
      console.warn('首页动态背景初始化失败，已使用静态背景', error);
      propsRef.current.onUnavailable?.();
      return;
    }
    const gl = renderer.gl;
    if (!renderer.isWebgl2) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      propsRef.current.onUnavailable?.();
      return;
    }
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';
    gl.canvas.style.display = 'block';
    gl.canvas.style.backgroundColor = 'transparent';

    let program: Program | undefined;

    function resize() {
      if (!ctn) return;
      const width = ctn.offsetWidth;
      const height = ctn.offsetHeight;
      renderer.dpr = Math.min(1, Math.sqrt(900_000 / Math.max(1, width * height)));
      renderer.setSize(width, height);
      if (program) {
        program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height];
      }
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(ctn);

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) {
      delete geometry.attributes.uv;
    }

    const initialStops = propsRef.current.colorStops.map((hex) => {
      const c = new Color(hex);
      return [c.r, c.g, c.b];
    });

    program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: propsRef.current.amplitude },
        uColorStops: { value: initialStops },
        uResolution: { value: [ctn.offsetWidth, ctn.offsetHeight] },
        uBlend: { value: propsRef.current.blend },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    ctn.appendChild(gl.canvas);

    let animateId = 0;
    let lastFrame = -Infinity;
    let visible = true;
    let heldStops = propsRef.current.colorStops;
    const update = (t: number) => {
      animateId = 0;
      if (document.hidden || !visible) return;
      animateId = requestAnimationFrame(update);
      if (t - lastFrame < 1000 / 30 - .5) return;
      lastFrame = t;
      const current = propsRef.current;
      if (program) {
        program.uniforms.uTime.value = t * 0.01 * current.speed * 0.1;
        program.uniforms.uAmplitude.value = current.amplitude;
        program.uniforms.uBlend.value = current.blend;
        if (heldStops !== current.colorStops) {
          heldStops = current.colorStops;
          program.uniforms.uColorStops.value = heldStops.map((hex) => {
            const color = new Color(hex);
            return [color.r, color.g, color.b];
          });
        }
        renderer.render({ scene: mesh });
      }
    };
    const syncVisibility = () => {
      cancelAnimationFrame(animateId);
      animateId = 0;
      if (!document.hidden && visible) {
        lastFrame = -Infinity;
        animateId = requestAnimationFrame(update);
      }
    };
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncVisibility();
    });
    const contextLost = () => {
      cancelAnimationFrame(animateId);
      propsRef.current.onUnavailable?.();
    };
    visibilityObserver.observe(ctn);
    document.addEventListener('visibilitychange', syncVisibility);
    gl.canvas.addEventListener('webglcontextlost', contextLost);
    syncVisibility();

    resize();

    return () => {
      cancelAnimationFrame(animateId);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', syncVisibility);
      gl.canvas.removeEventListener('webglcontextlost', contextLost);
      if (ctn && gl.canvas.parentNode === ctn) {
        ctn.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <div ref={ctnDom} className={`relative h-full w-full ${className}`.trim()} />;
}
