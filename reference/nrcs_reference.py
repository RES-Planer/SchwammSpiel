"""Referenz-Implementierung des NRCS-Rechenkerns (Schwammregion-Game).

Nachbau des VBA-Moduls aus der Masterarbeit Gehr (THD 2025, Kap. 3.4) OHNE Zugriff auf die
Original-Excel, rein aus Text + Anhang B8/B9 abgeleitet. Dient als ausfuehrbare Spezifikation
fuer die TypeScript-Portierung. Nur Standardbibliothek.

Aufruf:  python3 nrcs_reference.py ../fixtures/thesis_b8_cases.json

Abgeleitete (nicht im Text der Arbeit stehende) Annahmen – mit Original-Excel gegenpruefen:
  A1  'mittenbetont' = DVWK: 20 % des Regens in den ersten 30 % der Dauer, 50 % in den
      naechsten 20 %, 30 % in den letzten 50 %.
  A2  Dimensionslose Einheitsganglinie als Gamma-Funktion q/qp = (t/Tp)^m * exp(m*(1 - t/Tp)),
      m so, dass 645.33/PRF = e^m * Gamma(m+1) / m^(m+1)   (PRF 484 -> m ~ 3.7).
  A3  Rohrdrossel: Q = A_Rohr * sqrt(2*g*h / (2.5 + 0.02 * L/d)); aus vier Anhang-Faellen
      rueckgerechnet (entspricht 1 + Einlauf 0.5 + Auslauf 1.0 + lambda*L/d mit lambda = 0.02).
  A4  Speicherform 'Flaeche': Prisma V = A*h.  Speicherform 'Mulde': V_max = 2/3 * L*B*h_max,
      V(h) = V_max * (h/h_max)^1.5  (im Anhang exakt bestaetigt, z. B. 1d: 871 m3 bei 0.765 m).
  A5  Basisabfluss = Mq * A wird konstant addiert; Speicher wird explizit (Euler, Schritt dD)
      gerechnet.
"""
import json
import math
import sys

G = 9.81


def gamma_shape(prf):
    """Formparameter m der Gamma-Einheitsganglinie fuer einen Peak-Rate-Factor."""
    target = 645.33 / prf
    f = lambda m: math.exp(m + math.lgamma(m + 1) - (m + 1) * math.log(m)) - target
    lo, hi = 0.05, 30.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if f(lo) * f(mid) <= 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


RAIN_SHAPES = {
    "block": [(0, 0), (1, 1)],
    "mittenbetont": [(0, 0), (0.3, 0.2), (0.5, 0.7), (1, 1)],
    "anfangsbetont": [(0, 0), (0.2, 0.5), (0.5, 0.8), (1, 1)],   # TODO mit DVWK 1984 abgleichen
    "endbetont": [(0, 0), (0.5, 0.2), (0.8, 0.5), (1, 1)],       # TODO mit DVWK 1984 abgleichen
}


def cumulative_rain_fraction(x, shape):
    pts = RAIN_SHAPES[shape]
    x = min(max(x, 0.0), 1.0)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return 1.0


def effective_rain_mm(p_cum, cn, ia_ratio):
    s = 25400.0 / cn - 254.0
    ia = ia_ratio * s
    return 0.0 if p_cum <= ia else (p_cum - ia) ** 2 / (p_cum - ia + s)


def hydrograph(area_ha, cn, tc_h, p_mm, duration_h, ia_ratio, prf,
               rain_shape="mittenbetont", mq_l_s_km2=15.53, uh_cutoff=0.001):
    """Abflussganglinie [m3/s] im Zeitschritt dD. Gibt dict mit Q, dD, Tp, Neff usw. zurueck."""
    d_d = 0.133 * tc_h
    tp = d_d / 2 + 0.6 * tc_h
    n = max(1, round(duration_h / d_d))          # Regendauer auf ganze dD gerundet (wie VBA)
    cum = [effective_rain_mm(p_mm * cumulative_rain_fraction(i / n, rain_shape), cn, ia_ratio)
           for i in range(n + 1)]
    inc = [cum[i + 1] - cum[i] for i in range(n)]
    area_m2 = area_ha * 1e4
    m = gamma_shape(prf)
    qp_per_mm = area_m2 * 1e-3 / (tp * 3600 * (645.33 / prf))   # m3/s je mm Neff
    uh = [0.0]
    k = 1
    while True:
        tau = k * d_d / tp
        val = (tau ** m) * math.exp(m * (1 - tau))
        uh.append(qp_per_mm * val)
        if tau > 1 and val < uh_cutoff:
            break
        k += 1
    q = [0.0] * (n + len(uh))
    for i, r in enumerate(inc):
        if r:
            for j, u in enumerate(uh):
                q[i + j] += r * u
    base = mq_l_s_km2 * (area_ha / 100) / 1000
    q = [v + base for v in q]
    return dict(q=q, dD_h=d_d, tp_h=tp, neff_mm=cum[-1], base_m3s=base,
                q_max=max(q), s_mm=25400.0 / cn - 254.0)


def pipe_outflow(h, length_m, dn_mm):
    if h <= 0:
        return 0.0
    d = dn_mm / 1000
    return math.pi * d * d / 4 * math.sqrt(2 * G * h / (2.5 + 0.02 * length_m / d))


def route_storage(q_in, d_d_h, storage):
    """Speicher mit Rohrdrossel und Ueberlauf. storage: dict wie in den Fixtures."""
    v_max = storage["v_max_m3"]
    h_max = storage["h_max_m"]
    if storage["form"] == "Mulde":
        level = lambda v: h_max * (v / v_max) ** (2 / 3)
    else:
        level = lambda v: v / storage["base_area_m2"]
    dt = d_d_h * 3600
    v = 0.0
    out, h_peak, v_peak, spill_total = [], 0.0, 0.0, 0.0
    for qi in q_in:
        qo = min(pipe_outflow(level(v), storage["pipe_length_m"], storage["pipe_dn_mm"]), qi + v / dt)
        v = max(0.0, v + (qi - qo) * dt)
        spill = 0.0
        if v > v_max:                                  # Ueberlauf: Ueberschuss laeuft sofort ab
            spill = (v - v_max) / dt
            v = v_max
        spill_total += spill * dt
        out.append(qo + spill)
        h_peak, v_peak = max(h_peak, level(v)), max(v_peak, v)
    return dict(q=out, q_out_max=max(out), h_reached=h_peak, v_used=v_peak, spill_m3=spill_total)


def velocity_method_tc(segments, tc_factor=1.0, legacy_rounding=False):
    """Fliesszeit nach Geschwindigkeitsmethode (GMS): v = k * R^(2/3) * J^(1/2).
    segments: [{k, length_m, slope, r_hyd_m}];  legacy_rounding=True rundet v auf 0.01 m/s wie das VBA.
    Beispiel Anhang (1abc): k=17, l=48.5, J=0.041, R=0.002 -> v=0.05 m/s, t=16.17 min."""
    t_h = 0.0
    for s in segments:
        v = s["k"] * s["r_hyd_m"] ** (2 / 3) * math.sqrt(s["slope"])
        if legacy_rounding:
            v = max(0.01, round(v, 2))
        t_h += s["length_m"] / v / 3600
    return tc_factor * t_h


if __name__ == "__main__":
    data = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "../fixtures/thesis_b8_cases.json", encoding="utf-8"))
    worst_q = worst_qo = worst_h = 0.0
    for c in data["cases"]:
        if not c["consistent"]:
            continue
        r = hydrograph(c["area_ha"], c["cn"], c["tc_h"], c["p_mm"], c["duration_h"], c["ia_ratio"], c["prf"],
                       c["rain_shape"], c["mq_l_s_km2"])
        e = c["expected"]
        dq = r["q_max"] / e["q_max_m3s"] - 1
        worst_q = max(worst_q, abs(dq))
        line = f"{c['id']:38s} Qmax {r['q_max']:.3f} / {e['q_max_m3s']:.3f} ({dq*100:+5.1f} %)"
        if "storage" in c and not c["overflow_case"]:
            s = route_storage(r["q"], r["dD_h"], c["storage"])
            dqo = s["q_out_max"] / e["q_out_max_m3s"] - 1
            dh = s["h_reached"] / e["h_reached_m"] - 1
            worst_qo, worst_h = max(worst_qo, abs(dqo)), max(worst_h, abs(dh))
            line += f" | Qab {s['q_out_max']:.4f} / {e['q_out_max_m3s']:.4f} ({dqo*100:+5.1f} %) h {s['h_reached']:.3f} / {e['h_reached_m']:.3f} ({dh*100:+5.1f} %)"
        print(line)
    print(f"\nmax. Abweichung  Qmax {worst_q*100:.1f} %   Qab {worst_qo*100:.1f} %   Einstauhoehe {worst_h*100:.1f} %")
