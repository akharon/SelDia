"use strict";
// =============================================================================
// SelDiA — Visual Edit Types
// =============================================================================
// Types for the visual editing system that enables direct manipulation
// of rendered diagrams (drag-drop, double-click, inline property editing)
// with bidirectional sync to the DSL source code.
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditMode = void 0;
// -----------------------------------------------------------------------------
// Visual Edit State Machine
// -----------------------------------------------------------------------------
var EditMode;
(function (EditMode) {
    /** Default: pan, zoom, select */
    EditMode["IDLE"] = "idle";
    /** A node or edge is selected (shows handles, properties) */
    EditMode["SELECTED"] = "selected";
    /** Actively dragging a node to reposition */
    EditMode["DRAGGING"] = "dragging";
    /** Editing a label inline (text input active) */
    EditMode["EDITING_LABEL"] = "editing-label";
    /** Editing style properties (property panel open) */
    EditMode["EDITING_STYLE"] = "editing-style";
    /** Drawing a new edge (choose source then target) */
    EditMode["DRAWING_EDGE"] = "drawing-edge";
    /** Placing a new node on the canvas */
    EditMode["PLACING_NODE"] = "placing-node";
    /** Resizing a node via corner handle */
    EditMode["RESIZING"] = "resizing";
    /** Marquee selection (rubber-band rect) */
    EditMode["MARQUEE_SELECTING"] = "marquee-selecting";
})(EditMode || (exports.EditMode = EditMode = {}));
//# sourceMappingURL=visual-edit-types.js.map