import math, json

def oklch_to_srgb(L, C, h):
    a = C * math.cos(math.radians(h)); b = C * math.sin(math.radians(h))
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return [min(1, max(0, x)) for x in (r, g, bb)]

def lum(rgb):
    r, g, b = rgb
    return 0.2126*r + 0.7152*g + 0.0722*b

def enc(c): return 12.92*c if c <= 0.0031308 else 1.055*c**(1/2.4)-0.055
def hexof(rgb): return '#%02x%02x%02x' % tuple(round(enc(c)*255) for c in rgb)

def cr(a, b):
    la, lb = lum(oklch_to_srgb(*a)), lum(oklch_to_srgb(*b))
    hi, lo = max(la, lb), min(la, lb)
    return (hi+0.05)/(lo+0.05)

T = {
 'g0': (1,0,0), 'g1': (0.982,0.002,255), 'g2': (0.958,0.004,255), 'g3': (0.925,0.006,255), 'g4': (0.870,0.008,255),
 'g5': (0.760,0.012,255), 'g6': (0.565,0.016,255), 'g7': (0.520,0.018,255), 'g8': (0.420,0.020,255), 'g9': (0.300,0.020,255),
 'g10': (0.220,0.018,255), 'g11': (0.150,0.014,255),
 'brand600': (0.520,0.150,152), 'brand700': (0.460,0.130,153), 'brand800': (0.400,0.110,154), 'brand100': (0.955,0.030,155), 'brand300': (0.800,0.110,152),
 'info-fg': (0.470,0.150,258), 'info-bg': (0.955,0.025,258), 'ok-fg': (0.440,0.120,152), 'ok-bg': (0.955,0.030,155),
 'warn-fg': (0.480,0.130,70), 'warn-bg': (0.965,0.040,85), 'danger-fg': (0.480,0.180,27), 'danger-bg': (0.960,0.025,25),
 'violet-fg': (0.460,0.160,300), 'violet-bg': (0.960,0.025,300), 'teal-fg': (0.450,0.100,190), 'teal-bg': (0.955,0.030,190),
 'orange-fg': (0.500,0.160,45), 'orange-bg': (0.965,0.035,50),
 # dark
 'd-app': (0.175,0.006,260), 'd-panel': (0.215,0.006,260), 'd-sunken': (0.160,0.006,260), 'd-elev': (0.255,0.007,260),
 'd-fg': (0.870,0.006,255), 'd-strong': (0.960,0.003,255), 'd-muted': (0.680,0.012,255), 'd-subtle': (0.630,0.014,255), 'd-disabled': (0.450,0.012,255),
 'd-primary': (0.720,0.140,155), 'd-onbrand': (0.140,0.020,155), 'd-border': (0.300,0.008,260), 'd-border-strong': (0.380,0.010,260),
 'd-info-fg': (0.800,0.100,250), 'd-info-bg': (0.300,0.050,255), 'd-ok-fg': (0.820,0.120,152), 'd-ok-bg': (0.300,0.050,155),
 'd-warn-fg': (0.850,0.120,80), 'd-warn-bg': (0.320,0.060,75), 'd-danger-fg': (0.800,0.130,25), 'd-danger-bg': (0.320,0.070,25),
 'd-violet-fg': (0.820,0.100,300), 'd-violet-bg': (0.320,0.060,300), 'd-teal-fg': (0.820,0.090,190), 'd-teal-bg': (0.300,0.045,190),
 'd-orange-fg': (0.830,0.120,55), 'd-orange-bg': (0.320,0.065,50), 'd-selected': (0.300,0.045,155), 'd-link': (0.800,0.110,152),
 # dots
 'info-dot': (0.600,0.170,258), 'ok-dot': (0.620,0.150,152), 'warn-dot': (0.720,0.160,70), 'danger-dot': (0.600,0.210,27),
 'violet-dot': (0.620,0.180,300), 'teal-dot': (0.640,0.120,190), 'orange-dot': (0.680,0.180,45),
}
pairs = [
 ('g9','g0'),('g10','g0'),('g11','g0'),('g8','g0'),('g7','g0'),('g6','g0'),('g5','g0'),('g9','g1'),('g7','g1'),('g6','g1'),('g7','g2'),('g6','g2'),
 ('g0','brand600'),('g0','brand700'),('brand800','g0'),('brand600','g0'),('g9','brand100'),
 ('info-fg','info-bg'),('ok-fg','ok-bg'),('warn-fg','warn-bg'),('danger-fg','danger-bg'),('violet-fg','violet-bg'),('teal-fg','teal-bg'),('orange-fg','orange-bg'),
 ('info-fg','g0'),('warn-fg','g0'),('danger-fg','g0'),('ok-fg','g0'),
 ('d-fg','d-panel'),('d-strong','d-panel'),('d-muted','d-panel'),('d-subtle','d-panel'),('d-fg','d-app'),('d-muted','d-app'),('d-subtle','d-app'),('d-fg','d-elev'),('d-muted','d-elev'),('d-disabled','d-panel'),
 ('d-onbrand','d-primary'),('d-primary','d-panel'),('d-link','d-panel'),('d-fg','d-selected'),
 ('d-info-fg','d-info-bg'),('d-ok-fg','d-ok-bg'),('d-warn-fg','d-warn-bg'),('d-danger-fg','d-danger-bg'),('d-violet-fg','d-violet-bg'),('d-teal-fg','d-teal-bg'),('d-orange-fg','d-orange-bg'),
 ('d-info-fg','d-panel'),('d-warn-fg','d-panel'),('d-danger-fg','d-panel'),
 # non-text (3:1) : borders/dots
 ('g3','g0'),('g4','g0'),('g3','g1'),('d-border','d-panel'),('d-border-strong','d-panel'),
 ('info-dot','g0'),('ok-dot','g0'),('warn-dot','g0'),('danger-dot','g0'),('violet-dot','g0'),('teal-dot','g0'),('orange-dot','g0'),('g6','g0'),
 ('info-dot','d-panel'),('ok-dot','d-panel'),('warn-dot','d-panel'),('danger-dot','d-panel'),('violet-dot','d-panel'),('teal-dot','d-panel'),('orange-dot','d-panel'),
 ('g1','g0'),('g2','g0'),('g2','g1'),('d-app','d-panel'),('d-sunken','d-panel'),('d-elev','d-panel'),
]
out = {}
for a,b in pairs:
    out[f'{a} on {b}'] = round(cr(T[a],T[b]),2)
for k,v in out.items(): print(f'{k}: {v}')
print()
for k,v in T.items(): print(k, hexof(oklch_to_srgb(*v)))
