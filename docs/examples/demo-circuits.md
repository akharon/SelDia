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
