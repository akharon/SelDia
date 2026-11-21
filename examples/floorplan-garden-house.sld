floorplan "Garden House — Ground Floor" {
  meta [sheet] { type: "sheet", scale: "1:50", author: "M. Kaya", date: "2026-09-08" }

  Living   "Living Room" { type: "room", at: "0,0",   size: "5.4x4.2" }
  Kitchen  "Kitchen"     { type: "room", at: "5.4,0", size: "3.6x4.2" }
  Hall     "Hall"        { type: "room", at: "0,4.2", size: "2.4x2.6" }
  Bath     "Bathroom"    { type: "room", at: "2.4,4.2", size: "2.4x2.6" }
  Bed      "Bedroom"     { type: "room", at: "4.8,4.2", size: "4.2x2.6" }

  wf "window" { type: "window", at: "Living.north", offset: 1.4, width: 2.2 }
  wk "window" { type: "window", at: "Kitchen.north", offset: 1.0, width: 1.6 }
  wb "window" { type: "window", at: "Bed.south", offset: 1.2, width: 1.8 }
  de "door"   { type: "door",  at: "Hall.south", offset: 0.7, width: 0.9 }
  d1 "door"   { type: "door",  at: "Living.east", offset: 1.4, width: 0.9 }
  d2 "door"   { type: "door",  at: "Bath.north", offset: 0.8, width: 0.8 }
  d3 "door"   { type: "door",  at: "Bed.north", offset: 0.6, width: 0.9 }

  sofa  "sofa"  { type: "furniture", item: "sofa", in: "Living", at: "0.61,0.42" }
  tv    "tv"    { type: "furniture", item: "tv", in: "Living", at: "1.2,3.9" }
  rug   "rug"   { type: "furniture", item: "carpet-large", in: "Living", at: "1.3,1.6" }
  ct    "table" { type: "furniture", item: "coffee-table", in: "Living", at: "1.88,2.47" }

  ksink "sink"    { type: "furniture", item: "sink", in: "Kitchen", at: "0.3,0.3" }
  kst   "stove"   { type: "furniture", item: "stove", in: "Kitchen", at: "1.1,0.3" }
  kfr   "fridge"  { type: "furniture", item: "fridge", in: "Kitchen", at: "2.7,0.3" }
  kco   "counter" { type: "furniture", item: "counter", in: "Kitchen", at: "0.3,1.2" }
  ktb   "table"   { type: "furniture", item: "dining-table", in: "Kitchen", at: "0.88,2.56" }

  wc  "wc"     { type: "furniture", item: "toilet", in: "Bath", at: "0.18,1.01" }
  bsk "sink"   { type: "furniture", item: "sink-bath", in: "Bath", at: "0.27,2.1" }
  bsh "shower" { type: "furniture", item: "shower-cabin", in: "Bath", at: "1.3,1.5" }

  bd  "bed"      { type: "furniture", item: "bed-double", in: "Bed", at: "1.3,0.4" }
  wr  "wardrobe" { type: "furniture", item: "wardrobe", in: "Bed", at: "2.85,0.23" }

  m1 "clear" { type: "measure", from: "sofa", to: "ct" }
  m2 "walk"  { type: "measure", from: "ktb", to: "Kitchen.east" }
  node27: [New Node 27] { x: 497, y: 438 }
  node27: {New Node 27} { x: 497, y: 438 }
  node27: [New Node 27] { x: 497, y: 438 }
  node27: [New Node 27] { x: 497, y: 438 }
}
