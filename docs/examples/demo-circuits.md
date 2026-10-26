# SelDiA — Circuit Gallery

Circuit fences carry a raw SPICE netlist (or a SKiDL/KiCad `.net` file) that SelDiA lays out as a schematic. Each fence starts with `circuit`, and the netlist's first line is its title. See the [user guide](../user_guide.md#522-circuit-schematics) for the supported elements, hints and power-net rules.

## Voltage divider

```seldia
circuit
Voltage divider
V1 in 0 DC 10
R1 in out 10k
R2 out 0 4.7k
.op
.end
```

## RC low-pass filter

This fence uses a layout hint: `* @seldia rank in V1` puts the source in the first column.

```seldia
circuit
RC low-pass filter
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
* @seldia rank in V1
.ac dec 10 1 100k
.print ac vdb(out)
.end
```

## Inverting op-amp

An `.subckt` op-amp macro, instantiated as `X1`.

```seldia
circuit
Inverting amplifier, gain = -R2/R1 = -10
.subckt OPAMP inp inn out vcc vee
Rin inp inn 10meg
Eg mid 0 inp inn 1e5
Ro mid out 75
Rsup vcc vee 1meg
.ends OPAMP
V1 in 0 DC 0.5
R1 in inn 10k
R2 inn out 100k
X1 0 inn out VCC VEE OPAMP
V2 VCC 0 DC 15
V3 VEE 0 DC -15
.op
.end
```

## Common-emitter NPN amplifier

```seldia
circuit
Common-emitter NPN amplifier, voltage-divider bias
V1 VCC 0 DC 12
V2 src 0 AC 10m
R1 VCC base 47k
R2 base 0 10k
R3 VCC coll 2.2k
R4 emit 0 1k
C1 src base 10u
C2 coll out 10u
Q1 coll base emit NPN_MOD
R5 out 0 10k
.model NPN_MOD NPN (BF=100 IS=1e-14 VAF=100)
.op
.end
```

## SKiDL netlist

A KiCad `.net` file exported by SKiDL's `generate_netlist()`. SelDiA detects the `(export …)` form and reads it instead of SPICE.

```seldia
circuit
(export (version "E")
  (design
    (source "rc.py")
    (date "2026-10-26")
    (tool "SKiDL (1.2.0)"))
  (components
    (comp (ref "V1")
      (value "5V")
      (libsource (lib "pspice") (part "VSOURCE") (description "Voltage source"))
      (sheetpath (names "/") (tstamps "/")))
    (comp (ref "R1")
      (value "1k")
      (libsource (lib "Device") (part "R") (description "Resistor"))
      (sheetpath (names "/") (tstamps "/")))
    (comp (ref "C1")
      (value "100n")
      (libsource (lib "Device") (part "C") (description "Capacitor"))
      (sheetpath (names "/") (tstamps "/")))
    (comp (ref "Q1")
      (value "2N3904")
      (libsource (lib "Transistor_BJT") (part "Q_NPN_BCE") (description "NPN"))
      (sheetpath (names "/") (tstamps "/")))
    (comp (ref "R2")
      (value "220")
      (libsource (lib "Device") (part "R") (description "Resistor"))
      (sheetpath (names "/") (tstamps "/"))))
  (nets
    (net (code "1") (name "GND")
      (node (ref "V1") (pin "2") (pinfunction "-"))
      (node (ref "C1") (pin "2") (pinfunction "~"))
      (node (ref "R2") (pin "2") (pinfunction "~"))
      (node (ref "Q1") (pin "3") (pinfunction "E")))
    (net (code "2") (name "VIN")
      (node (ref "V1") (pin "1") (pinfunction "+"))
      (node (ref "R1") (pin "1") (pinfunction "~")))
    (net (code "3") (name "/mid")
      (node (ref "R1") (pin "2") (pinfunction "~"))
      (node (ref "C1") (pin "1") (pinfunction "~"))
      (node (ref "Q1") (pin "2") (pinfunction "B")))
    (net (code "4") (name "OUT")
      (node (ref "Q1") (pin "1") (pinfunction "C"))
      (node (ref "R2") (pin "1") (pinfunction "~")))))
```


## Full-bridge rectifier

Four diodes turn an AC source into a rectified rail, smoothed by a capacitor. This one uses the `spice` fence spelling: the body is the raw netlist, with no `circuit` header line.

```spice
Full-bridge rectifier with smoothing capacitor and load
V1 acA acB SIN(0 17 60)
D1 acA pos D1N4007
D2 acB pos D1N4007
D3 0 acA D1N4007
D4 0 acB D1N4007
C1 pos 0 470u
R1 pos 0 1k
.model D1N4007 D(IS=76.9p RS=42m N=1.45 BV=1000 IBV=5u)
.tran 0.1m 50m
.print tran v(pos)
.end
```

## CMOS inverter

A PMOS pull-up and an NMOS pull-down share the gate and drain. `VDD` is drawn as a power symbol. The `circuit` fence spelling works the same way.

```circuit
CMOS inverter, 1.8 V
V1 VDD 0 DC 1.8
V2 in 0 PULSE(0 1.8 0 1n 1n 5n 10n)
M1 out in VDD VDD PMOS_MOD W=2u L=0.18u
M2 out in 0 0 NMOS_MOD W=1u L=0.18u
C1 out 0 10f
.model NMOS_MOD NMOS (VTO=0.5 KP=170u)
.model PMOS_MOD PMOS (VTO=-0.5 KP=60u)
.tran 0.1n 40n
.end
```

## LED driver

A series resistor sets the LED current. The `netlist` spelling is a third alias for the same fence.

```netlist
LED driver: 5 V supply, 330 ohm series resistor
V1 VCC 0 DC 5
R1 VCC anode 330
D1 anode 0 LEDRED
.model LEDRED D(IS=1e-20 N=2 RS=5)
.op
.end
```

## Two-stage amplifier with emitter follower

A common-emitter gain stage drives an emitter-follower buffer. Both stages share the `VCC` and ground symbols, so every shared net becomes a junction dot or a power symbol rather than a long wire. The hints keep the source on the left and the load on the right.

```spice
Two-stage amplifier: CE gain stage + emitter follower
V1 VCC 0 DC 12
V2 src 0 AC 10m
C1 src b1 10u
R1 VCC b1 47k
R2 b1 0 10k
R3 VCC c1 2.2k
R4 e1 0 1k
Q1 c1 b1 e1 NPN_MOD
C2 c1 b2 10u
R5 VCC b2 100k
R6 b2 0 100k
Q2 VCC b2 e2 NPN_MOD
R7 e2 0 1k
C3 e2 out 10u
RL out 0 10k
.model NPN_MOD NPN (BF=100 IS=1e-14 VAF=100)
* @seldia rank in V2
* @seldia rank out RL
* @seldia rotate R4 90
.op
.end
```

## KiCad netlist in a `kicad` fence

A `kicad` fence whose body is an `(export ...)` netlist is drawn as a schematic, the same as a `circuit` fence. Netlists take no layout hints.

```kicad
(export (version "E")
  (components
    (comp (ref "V1") (value "9V")
      (libsource (lib "pspice") (part "VSOURCE")))
    (comp (ref "R1") (value "470")
      (libsource (lib "Device") (part "R")))
    (comp (ref "D1") (value "LED")
      (libsource (lib "Device") (part "LED")))
    (comp (ref "R2") (value "10k")
      (libsource (lib "Device") (part "R"))))
  (nets
    (net (code "1") (name "GND")
      (node (ref "V1") (pin "2") (pinfunction "-"))
      (node (ref "D1") (pin "1") (pinfunction "K"))
      (node (ref "R2") (pin "2") (pinfunction "~")))
    (net (code "2") (name "VIN")
      (node (ref "V1") (pin "1") (pinfunction "+"))
      (node (ref "R1") (pin "1") (pinfunction "~"))
      (node (ref "R2") (pin "1") (pinfunction "~")))
    (net (code "3") (name "/led")
      (node (ref "R1") (pin "2") (pinfunction "~"))
      (node (ref "D1") (pin "2") (pinfunction "A")))))
```

## Sallen-Key low-pass filter

A second-order active filter built on the `OPAMP` macro. The op-amp is wired as a unity-gain follower, and the feedback capacitor `C1` returns from the output. The supply sources are separate islands joined to the op-amp by `VCC` and `VEE` power symbols.

```circuit
Sallen-Key low-pass, unity gain, fc about 1.6 kHz
.subckt OPAMP inp inn out vcc vee
Rin inp inn 10meg
Eg mid 0 inp inn 1e5
Ro mid out 75
Rsup vcc vee 1meg
.ends OPAMP
V1 in 0 AC 1
R1 in n1 10k
R2 n1 n2 10k
C1 n1 out 10n
C2 n2 0 10n
X1 n2 out out VCC VEE OPAMP
V2 VCC 0 DC 15
V3 VEE 0 DC -15
* @seldia rank in V1
.ac dec 20 10 100k
.end
```

## PCB board view

A render-only view of a KiCad `.kicad_pcb`. Add `side: back` for the mirrored back view.

```pcb
(kicad_pcb (version 20221018) (generator "seldia-fixture")
  (net 0 "") (net 1 "VCC") (net 2 "SIG") (net 3 "GND")
  (gr_line (start 100 100) (end 130 100) (layer "Edge.Cuts") (width 0.1))
  (gr_line (start 130 100) (end 130 120) (layer "Edge.Cuts") (width 0.1))
  (gr_line (start 130 120) (end 100 120) (layer "Edge.Cuts") (width 0.1))
  (gr_line (start 100 120) (end 100 100) (layer "Edge.Cuts") (width 0.1))
  (footprint "Resistor_SMD:R_0805" (layer "F.Cu") (at 108 106 0)
    (fp_text reference "R1" (at 0 -1.8) (layer "F.SilkS"))
    (fp_line (start -0.9 -1.2) (end 0.9 -1.2) (layer "F.SilkS") (width 0.12))
    (fp_line (start -0.9 1.2) (end 0.9 1.2) (layer "F.SilkS") (width 0.12))
    (pad "1" smd roundrect (at -1 0 0) (size 1 1.4) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
    (pad "2" smd roundrect (at 1 0 0) (size 1 1.4) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25)))
  (footprint "Resistor_SMD:R_0805" (layer "F.Cu") (at 108 114 90)
    (fp_text reference "R2" (at 0 -1.8) (layer "F.SilkS"))
    (fp_line (start -0.9 -1.2) (end 0.9 -1.2) (layer "F.SilkS") (width 0.12))
    (fp_line (start -0.9 1.2) (end 0.9 1.2) (layer "F.SilkS") (width 0.12))
    (pad "1" smd roundrect (at -1 0 90) (size 1 1.4) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
    (pad "2" smd roundrect (at 1 0 90) (size 1 1.4) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25)))
  (footprint "LED_SMD:LED_0805" (layer "F.Cu") (at 118 110 0)
    (fp_text reference "D1" (at 0 -1.8) (layer "F.SilkS"))
    (fp_circle (center 0 0) (end 1.4 0) (layer "F.SilkS") (width 0.12))
    (pad "1" smd rect (at -1 0) (size 1.2 1.4) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "2" smd rect (at 1 0) (size 1.2 1.4) (layers "F.Cu" "F.Paste" "F.Mask")))
  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x02" (layer "F.Cu") (at 124 108 0)
    (fp_text reference "J1" (at 0 -2.4) (layer "F.SilkS"))
    (fp_rect (start -1.3 -1.3) (end 1.3 3.84) (layer "F.SilkS") (width 0.12))
    (pad "1" thru_hole rect (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask"))
    (pad "2" thru_hole circle (at 0 2.54) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask")))
  (segment (start 107 106) (end 117 110) (width 0.4) (layer "F.Cu") (net 1))
  (segment (start 119 110) (end 124 108) (width 0.4) (layer "F.Cu") (net 2))
  (segment (start 108 112.8) (end 108 106) (width 0.25) (layer "B.Cu") (net 3))
  (segment (start 109 114) (end 124 110.54) (width 0.25) (layer "B.Cu") (net 3))
  (via (at 108 112.8) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 3))
)
```

## LED board (second PCB)

A small `kicad_pcb` board with a resistor, an LED and a header. This one uses the ```` ```kicad ```` spelling (the body starts with `(kicad_pcb`, so it is read as a board, not a netlist) and is drawn as the front view.

```kicad
(kicad_pcb (version 20221018) (generator "seldia-fixture")
  (net 0 "") (net 1 "VIN") (net 2 "LED") (net 3 "GND")
  (gr_rect (start 100 100) (end 122 114) (layer "Edge.Cuts") (width 0.1))
  (footprint "Resistor_SMD:R_0805" (layer "F.Cu") (at 108 107 0)
    (fp_text reference "R1" (at 0 -1.8) (layer "F.SilkS"))
    (fp_line (start -0.9 -1.2) (end 0.9 -1.2) (layer "F.SilkS") (width 0.12))
    (fp_line (start -0.9 1.2) (end 0.9 1.2) (layer "F.SilkS") (width 0.12))
    (pad "1" smd roundrect (at -1 0 0) (size 1 1.4) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
    (pad "2" smd roundrect (at 1 0 0) (size 1 1.4) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25)))
  (footprint "LED_SMD:LED_0805" (layer "F.Cu") (at 114 107 0)
    (fp_text reference "D1" (at 0 -1.8) (layer "F.SilkS"))
    (fp_circle (center 0 0) (end 1.4 0) (layer "F.SilkS") (width 0.12))
    (pad "1" smd rect (at -1 0) (size 1.2 1.4) (layers "F.Cu" "F.Paste" "F.Mask"))
    (pad "2" smd rect (at 1 0) (size 1.2 1.4) (layers "F.Cu" "F.Paste" "F.Mask")))
  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x02" (layer "F.Cu") (at 104 110 90)
    (fp_text reference "J1" (at 0 -2.4) (layer "F.SilkS"))
    (fp_rect (start -1.3 -1.3) (end 1.3 3.84) (layer "F.SilkS") (width 0.12))
    (pad "1" thru_hole rect (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask"))
    (pad "2" thru_hole circle (at 0 2.54) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask")))
  (segment (start 104 110) (end 104 107) (width 0.4) (layer "F.Cu") (net 1))
  (segment (start 104 107) (end 107 107) (width 0.4) (layer "F.Cu") (net 1))
  (segment (start 109 107) (end 113 107) (width 0.4) (layer "F.Cu") (net 2))
  (segment (start 115 107) (end 118 107) (width 0.25) (layer "B.Cu") (net 3))
  (segment (start 118 107) (end 118 112.54) (width 0.25) (layer "B.Cu") (net 3))
  (segment (start 118 112.54) (end 104 112.54) (width 0.25) (layer "B.Cu") (net 3))
  (via (at 115 107) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 3))
)
```
