<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-039 — Canonical Design Document Format & Runtime

> **Status:** Accepted (2026-09-15) — ratified after review; previously Proposed rev. 2 with the review amendments integrated
> **Scope:** Unifia — Design / Phase 7 of the v110 port campaign
> **Decision owners:** Unifia architecture
> **Supersedes:** none
>
> **Revision 2 changes:** renderer binding corrected to framework-agnostic
> Konva (the app is SolidJS — no React may enter `packages/app`); storage
> authority named (workspace/artifact store, localStorage only as fallback);
> `LineNodeV1` + `PathNodeV1` added to V1 so the Phase 7 vector rows can
> close; validation technology named (zod, relocatable to a shared
> contract); renderer lazy-loading and headless-test requirements added;
> legacy layer model absorption made explicit (D7-G11).

## 1. Context

The current Unifia Design implementation is not yet a native design-document runtime.

Verified state (2026-09-15, branch `new-ui`):

- `packages/app/src/pages/workbench/design-sketch-tab.tsx` (43 LOC) embeds
  `/design-sketch/index.html` through an iframe and communicates via
  `postMessage` (`unifia:sketch-ready` / `sketch-load` / `sketch-change`).
  The host receives a design snapshot as an opaque `unknown` and persists it
  directly to `localStorage` under the key `unifia-design-sketch:v1:<id>`.
  A corrupt entry is dropped so the tab recovers (the bad value would
  otherwise throw on every reopen).
- `packages/design-sketch/` is an Excalidraw embed (its React 18 dependency
  is isolated inside that package's own bundle, not the app's).
- `design-layers-model.ts` + `design-layers-panel.tsx` ship a placeholder
  `Layer` model with a fabricated `defaultLayers()` fixture
  (Background/Structure/Content/Annotations). `design-vector-tools.tsx`
  and `design-layers-panel.tsx` have **zero imports outside their own files**
  (orphaned MVP stubs: layers/vector are ✅ partial in the M3 matrix, canvas
  is a fake).
- The repository already owns substrate this document must reconcile with:
  `packages/artifact-store` / `packages/artifact-runtime` (ADR-1039),
  the workspace manifest `.unifia/workspace.json` (ADR-1040), the Design
  capability set (ADR-1038), and `packages/design-system-runtime` for
  `DESIGN.md` catalogs.
- `packages/app` is a SolidJS application (`solid-js`, `vite-plugin-solid`,
  `@solidjs/testing-library`); it has **no React dependency**. React exists
  only in isolated non-app packages (`design-sketch` embed, `console/mail`,
  `storybook`). zod is already an app dependency. Konva is not present
  anywhere in the monorepo yet.

This architecture was sufficient to prototype the visual surface, but it is not a stable foundation for the intended Unifia Design feature set. Phase 7 requires, among other capabilities:

- native selection and manipulation;
- resize;
- rotation;
- snapping and transient alignment guides;
- deterministic layer ordering;
- drag-and-drop reordering of layers;
- reparenting between frames/groups;
- visibility and locking;
- document persistence;
- schema evolution and migrations;
- undo/redo;
- vector/SVG editing (line, path, Bézier) per the Phase 7 acceptance matrix;
- future Design System / style-token support;
- portability across desktop, web, tablet and mobile;
- future agentic manipulation of the document through typed operations.

These capabilities require Unifia to own a stable document model independently from the rendering library.

The current iframe snapshot cannot be considered this model because:

1. its structure is not a public Unifia domain contract;
2. it is handled as opaque data (`JSON.parse` into `unknown`);
3. renderer/editor state can leak into persisted state;
4. there is no reliable schema-version migration path;
5. document operations cannot be expressed consistently outside the embedded editor;
6. layers, transforms and future AI operations would become coupled to the embedded implementation.

Therefore Phase 7 MUST NOT implement the missing design capabilities directly against the current iframe snapshot.

---

# 2. Decision

Unifia SHALL introduce a **renderer-independent, versioned canonical Design Document model owned by Unifia**.

The document model SHALL be the source of truth.

The graphical runtime SHALL be an adapter that renders this model and converts user interactions into typed document mutations.

The initial native renderer SHALL use **Konva's framework-agnostic core** (the `konva` package, no React binding), provided the final dependency validation holds. It SHALL NOT use `react-konva`: `packages/app` is SolidJS, and adding React/react-dom/react-reconciler to the application would introduce a second reconciler, contradict §3.2 (renderer independence) and impose an unjustified bundle and architecture cost. The adapter is driven by Solid reactivity (`createEffect` / `onCleanup`) and connects to the canvas imperatively, which is exactly what Konva's imperative API is designed for.

Neither Konva serialization, Excalidraw serialization, Fabric serialization nor any renderer-specific object graph SHALL become the canonical persisted document format.

Conceptually:

```text
                 ┌──────────────────────────┐
                 │   DesignDocument         │
                 │   canonical + versioned  │
                 └─────────────┬────────────┘
                               │
                typed commands / operations
                               │
                 ┌─────────────▼────────────┐
                 │ Document state / history │
                 └─────────────┬────────────┘
                               │
                      renderer adapter
                               │
                 ┌─────────────▼────────────┐
                 │ Konva runtime (vanilla)  │
                 │                          │
                 │ render / hit test        │
                 │ drag / resize / rotate   │
                 └──────────────────────────┘
```

This separation is normative.

---

# 3. Architectural principles

The following rules SHALL hold for the Design subsystem.

### 3.1 Document state is not editor state

Persistent design state and transient interaction state SHALL remain separate.

Persistent state includes:

- node identity;
- hierarchy;
- geometry;
- rotation;
- dimensions;
- styles;
- visibility;
- lock state;
- asset references;
- component/design-system references when introduced.

Transient state includes:

- current selection;
- hover state;
- active transformation;
- snap guides;
- pointer state;
- context menus;
- viewport pan;
- viewport zoom;
- drag previews;
- transform handles.

Transient state MUST NOT pollute the canonical document unless explicitly promoted to document metadata by a future ADR.

### 3.2 Renderer independence

The canonical document MUST be renderable by another implementation without first loading Konva.

A future SVG, WebGPU, Canvas2D or native renderer MUST be able to consume the same document model.

### 3.3 Explicit versioning

Every persisted document SHALL declare a `schemaVersion`.

A document without a recognized version MUST NOT silently be interpreted as the current schema.

### 3.4 Typed mutations

UI components and rendering adapters SHOULD NOT mutate document objects directly.

Changes SHALL pass through typed operations or commands.

This provides the common foundation for:

- undo/redo;
- deterministic tests;
- collaboration later;
- agent-driven editing;
- replay/debugging;
- telemetry;
- transaction grouping.

### 3.5 Renderer isolation in runtime and tests

The renderer adapter SHALL be loaded lazily and client-only. Importing the Design surface MUST NOT require canvas/DOM APIs at module load (the app's unit suites run under happy-dom). Unit tests for the document model, commands, validation and history SHALL run headless, without importing the Konva adapter.

---

# 4. Canonical Design Document V1

The initial format SHALL use a normalized JSON-compatible scene graph.

A representative TypeScript contract is:

```ts
export type DesignNodeId = string

export interface DesignDocumentV1 {
  schemaVersion: 1

  id: string
  name: string

  rootIds: DesignNodeId[]

  nodes: Record<DesignNodeId, DesignNodeV1>

  assets?: Record<string, DesignAssetV1>

  metadata?: {
    createdAt?: string
    updatedAt?: string
  }
}
```

`nodes` SHALL be normalized rather than persisted as one deeply nested mutable object graph.

This simplifies:

- node lookup;
- transactional mutations;
- undo/redo;
- layer reordering;
- reparenting;
- AI tool operations;
- future collaborative editing;
- document validation.

---

# 5. Node model

V1 SHALL define a shared base contract.

```ts
export interface DesignNodeBaseV1 {
  id: DesignNodeId

  name: string

  parentId: DesignNodeId | null

  visible: boolean
  locked: boolean

  transform: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
  }
}
```

Supported primitive families in V1:

```ts
type DesignNodeV1 =
  | FrameNodeV1
  | GroupNodeV1
  | RectangleNodeV1
  | EllipseNodeV1
  | LineNodeV1
  | PathNodeV1
  | TextNodeV1
  | ImageNodeV1
```

`LineNodeV1` and `PathNodeV1` are required by the Phase 7 acceptance matrix (line tool, Bézier path, vector tools). SVG path data is a stable, portable, renderer-agnostic representation and maps directly to Konva's `Path` and to a future SVG export target:

```ts
export interface DesignStyleV1 {
  fill?: string
  stroke?: string
  strokeWidth?: number
  opacity?: number
}

export interface LineNodeV1 extends DesignNodeBaseV1 {
  type: "line"
  /** Polyline in node-local space, at least 2 points. */
  points: Array<{ x: number; y: number }>
  stroke?: string
  strokeWidth?: number
}

export interface PathNodeV1 extends DesignNodeBaseV1 {
  type: "path"
  /** SVG path data (`d`). Renderer-agnostic and export-ready. */
  d: string
  style?: DesignStyleV1
}
```

Additional primitives SHALL be introduced through additive schema evolution rather than renderer-specific escape hatches.

Container nodes SHALL expose ordered children:

```ts
interface DesignContainerV1 {
  childIds: DesignNodeId[]
}
```

`rootIds` and `childIds` are authoritative for sibling ordering.

---

# 6. Coordinate and transform semantics

Coordinate semantics MUST be defined by Unifia rather than inherited implicitly from Konva.

For V1:

- `x` and `y` are expressed in parent-local coordinates;
- `width` and `height` are canonical dimensions;
- `rotation` is stored in degrees;
- rotation is clockwise;
- rotation conceptually occurs around the object's center;
- scale is NOT persisted as the normal representation of resize.

A renderer MAY temporarily use `scaleX` / `scaleY` during an interactive transformation.

At transform commit:

```text
canonical width  = old width  × runtime scaleX
canonical height = old height × runtime scaleY

runtime scaleX → 1
runtime scaleY → 1
```

The resulting canonical document therefore remains independent from Konva transformation implementation details.

Negative dimensions MUST NOT be produced by ordinary resize operations.

A future requirement for mirroring SHALL use explicit flip semantics rather than relying on negative width/height.

---

# 7. Runtime decision

The initial native Design renderer SHALL use:

**Konva's framework-agnostic core behind a dedicated runtime boundary.**

Conceptually (SolidJS — props are accessors, per the app's conventions):

```tsx
<DesignCanvas
  document={document()}
  editorState={editorState()}
  dispatch={dispatch}
/>
```

The renderer SHALL:

- project canonical nodes into runtime nodes;
- perform hit testing;
- render selection;
- handle pointer interactions;
- expose resize/rotate handles (Konva `Transformer`);
- calculate interactive snapping;
- emit typed canonical commands.

It SHALL NOT become the document store.

It SHALL NOT expose Konva node objects outside the runtime layer.

It SHALL NOT be imported anywhere outside the Design surface; the import SHALL be dynamic/lazy so code outside Design pays no bundle cost.

---

# 8. Why Konva

Konva is selected because Phase 7 primarily requires an interactive 2D editor rather than only static SVG rendering.

Its framework-agnostic core provides useful low-level primitives for:

- Canvas rendering;
- hit testing;
- dragging;
- transformations;
- rotation;
- groups;
- layering;
- pointer interactions;
- custom selection and guide overlays;
- a `Transformer` abstraction (resize/rotate handles) that is part of the core library, not a framework binding.

This choice is intentionally narrower than choosing a complete editor framework.

Unifia owns:

```text
document
operations
history
selection semantics
layer semantics
persistence
migrations
design-system semantics
AI manipulation API
```

Konva owns:

```text
rendering
hit testing
pointer-level interaction primitives
temporary graphical transforms
```

`react-konva` is explicitly excluded (see §2). The absence of a React binding is not a limitation here: the adapter owns the reconciliation between Solid signals and Konva's imperative node tree.

---

# 9. Snapping

Snapping SHALL be implemented as editor/runtime logic and SHALL NOT be represented as persistent document state.

Candidate snap targets SHOULD include:

- parent/frame bounds;
- sibling left/right edges;
- sibling top/bottom edges;
- horizontal center;
- vertical center.

Guides SHALL be calculated from transformed geometry.

The snapping threshold MUST be visually stable at different zoom levels.

Therefore it SHALL be specified in screen pixels and converted to world-space units:

```ts
const thresholdWorld = thresholdPx / viewport.zoom
```

Temporary guide lines MUST disappear after interaction completion.

The architecture SHOULD permit future snapping extensions for:

- grids;
- spacing;
- equal distribution;
- design tokens;
- object baselines;
- configurable angle snapping.

Angle snapping MAY initially support conventional increments such as 15°, but this is an editor policy and MUST NOT affect the canonical format.

---

# 10. Layer hierarchy

The canonical document hierarchy SHALL be the single source of truth for both:

- rendering order;
- Layers panel.

For each container:

```ts
childIds: DesignNodeId[]
```

V1 ordering semantics SHALL be:

```text
index 0       = furthest back
last index    = furthest front
```

The Layers panel MAY display this list in reverse order so the visually frontmost object appears at the top of the panel.

It MUST NOT maintain its own independent ordering model.

The existing `design-layers-model.ts` placeholder (including its fabricated `defaultLayers()`) SHALL be superseded by the canonical hierarchy: either deleted once the panel reads the document, or reduced to pure view helpers that operate on canonical `childIds`.

---

# 11. Layer drag-and-drop

Layer DnD SHALL produce domain operations, not direct array manipulation from the UI.

Required operations include:

```ts
reorderNode(...)
reparentNode(...)
```

A reparent operation MUST validate at least:

- target container capability;
- node existence;
- target existence;
- locked state where applicable;
- prevention of parent/child cycles.

For example:

```text
Frame A
 └ Group B
    └ Rectangle C
```

`Frame A` MUST NOT be reparented into `Group B` or `Rectangle C`.

The domain layer SHALL reject invalid structural operations regardless of where they originate:

- Layers UI;
- canvas;
- keyboard command;
- automation;
- AI agent.

---

# 12. Canonical command surface

The initial mutation layer SHOULD expose operations equivalent to:

```ts
insertNode(...)
deleteNode(...)

updateNode(...)
updateTransform(...)

reorderNode(...)
reparentNode(...)

setVisibility(...)
setLocked(...)

duplicateNode(...)
```

Batching SHOULD be supported.

One user gesture SHOULD normally become one history transaction.

For example, moving an object through 200 pointer events MUST NOT necessarily create 200 undo entries.

Instead:

```text
pointer down
→ transient transformation

pointer move
→ transient updates

pointer up
→ one committed document transaction
```

---

# 13. Undo / redo

Undo and redo SHALL operate at the canonical document-operation layer.

They MUST NOT depend on the renderer's internal history implementation.

This ensures operations originating from canvas, Layers panel or future AI actions behave consistently.

At minimum, history SHALL cover:

- move;
- resize;
- rotate;
- create;
- delete;
- duplicate;
- reorder;
- reparent;
- visibility changes;
- locking changes.

Transient selection and viewport operations SHOULD NOT normally create document history entries.

---

# 14. Persistence boundary

Persistence SHALL be represented by a dedicated repository abstraction.

For example:

```ts
interface DesignDocumentRepository {
  load(id: string): Promise<DesignDocument>
  save(document: DesignDocument): Promise<void>
  remove(id: string): Promise<void>
}
```

### Storage authority (named now)

The target authority for persisted design documents is the **workspace store** — a workspace-owned file or an artifact per ADR-1039 / ADR-1040 — not browser storage. Design documents must be durable, portable across desktop/web/tablet/mobile and visible to workspace tooling.

The initial implementation MAY be `localStorage` on the web target, behind the same repository interface, as a temporary fallback. It SHALL NOT be treated as durable, portable, or the long-term authority. The repository interface is designed against the target (a document id maps to a workspace path or artifact id), so the storage swap is mechanical.

The legacy `unifia-design-sketch:v1:<id>` key SHALL NOT be reused as the canonical store; migration from it is an explicit slice (see §17, §26).

```text
DesignDocumentRepository
        │
        └── LocalStorageDesignDocumentRepository   (initial web fallback only)
        └── WorkspaceDesignDocumentRepository      (target)
        └── ArtifactDesignDocumentRepository       (target, per ADR-1039)
```

Later implementations can replace or complement it without changing the canvas runtime or document format:

```text
SQLiteDesignDocumentRepository
RemoteDesignDocumentRepository
CollaborativeDesignDocumentRepository
```

---

# 15. Validation

All persisted documents MUST be validated when loaded.

Runtime validation SHALL use **zod** (already a dependency of `packages/app`).

The schema SHALL remain framework-free and dependency-light so that it can be relocated to a shared contract package (`packages/contracts`) once server-side or agent-side validation lands — no app-specific imports in the schema module.

Validation MUST cover at least:

- schema version;
- node types;
- node IDs;
- parent IDs;
- dimensions;
- required node-specific properties;
- duplicate references;
- nonexistent children;
- hierarchy cycles.

Malformed documents MUST fail safely.

They MUST NOT produce partially undefined renderer state.

---

# 16. Schema migrations

Schema evolution SHALL use explicit deterministic migrations.

Conceptually:

```ts
migrateV1ToV2(document)
migrateV2ToV3(document)
```

Loading SHALL follow:

```text
raw persisted JSON
       │
       ▼
detect schemaVersion
       │
       ▼
validate old schema
       │
       ▼
run sequential migrations
       │
       ▼
validate current schema
       │
       ▼
open document
```

A document whose schema version is newer than the runtime understands MUST NOT be silently downgraded or rewritten.

The application SHOULD fail safely and preserve the original bytes.

---

# 17. Legacy iframe migration

The current iframe implementation SHALL be considered a **legacy Design runtime**, not the canonical architecture.

The migration SHALL NOT blindly cast:

```ts
snapshot: unknown
```

into:

```ts
DesignDocumentV1
```

A legacy import adapter MAY be implemented if the old snapshot schema is sufficiently deterministic. The Excalidraw scene format is documented and versioned, but the stored value is untrusted: the importer MUST validate every field it consumes (mirroring the existing corrupt-entry recovery in `design-sketch-tab.tsx`).

Conceptually:

```text
Legacy snapshot (localStorage `unifia-design-sketch:v1:*`)
     │
     ▼
LegacySnapshotParser (untrusted input)
     │
     ▼
Legacy → V1 conversion
     │
     ▼
schema validation
     │
     ▼
DesignDocumentV1
```

If reliable conversion is impossible for some legacy documents, Unifia SHALL preserve the original legacy data rather than silently corrupt or partially interpret it.

Once native feature parity has been reached and migration requirements have been satisfied, the iframe runtime SHALL be removed.

---

# 18. Recommended module boundary

The Design implementation SHOULD converge toward a structure similar to (exact paths MAY be adapted to existing app conventions — e.g. under `packages/app/src/pages/workbench/design/`):

```text
features/design/
│
├── model/
│   ├── schema.ts
│   ├── commands.ts
│   ├── reducer.ts
│   ├── validation.ts
│   └── migrations.ts
│
├── state/
│   ├── design-store.ts
│   ├── editor-state.ts
│   └── history.ts
│
├── runtime/
│   ├── design-canvas.tsx
│   └── konva/
│       ├── konva-canvas.ts               (lazy-loaded, client-only)
│       ├── node-renderer.ts
│       ├── transformer.ts
│       ├── geometry.ts
│       └── snapping.ts
│
├── layers/
│   ├── layers-panel.tsx
│   └── layer-dnd.ts
│
└── persistence/
    ├── repository.ts
    └── local-storage-repository.ts
```

The model/state layers MUST NOT import the runtime layer.

---

# 19. Text editing

Text rendering and text editing MUST be treated separately.

Konva MAY render text.

Native text entry MAY temporarily use an HTML textarea/content-editable overlay aligned with the canvas object during edit mode.

Text editing therefore MUST NOT force the canonical document toward DOM-specific or Konva-specific representation.

---

# 20. Assets

Binary images MUST NOT normally be embedded as large base64 strings directly inside every design node.

Image nodes SHOULD reference an asset identifier:

```ts
interface ImageNodeV1 extends DesignNodeBaseV1 {
  type: "image"

  assetId: string
}
```

The document can contain or reference asset metadata independently.

This separation enables future:

- workspace asset stores;
- caching;
- deduplication;
- remote sync;
- export;
- collaboration.

Asset storage SHOULD reconcile with the existing artifact/workspace substrate (ADR-1039 / ADR-1040) rather than inventing a parallel store.

---

# 21. Design tokens and future Design System support

The document schema SHALL remain extensible toward Unifia Design System functionality.

A future node property MAY reference semantic tokens instead of permanently resolving every value.

For example:

```ts
fill: {
  kind: "token"
  tokenId: "color.surface.primary"
}
```

or:

```ts
fill: {
  kind: "literal"
  value: "#ffffff"
}
```

The exact token schema is outside the scope of this ADR, and MUST reconcile with the design-system contract of ADR-1040 (`.unifia/workspace.json` authority, `DESIGN.md` content).

However, V1 implementation MUST avoid an architecture that makes token references impossible.

---

# 22. Agentic editing

One motivation for owning the canonical document model is that Unifia agents must eventually be able to inspect and edit designs without simulating mouse movement.

Future tools should be able to express operations such as:

```text
create rectangle
move node
resize frame
change typography
reparent element
apply token
align selection
distribute selection
```

through the same document-operation layer used by the user interface.

AI-generated document modifications MUST NOT manipulate Konva objects directly.

This is a deliberate architectural requirement.

---

# 23. Portability

The canonical DesignDocument SHALL contain no dependency on:

- browser DOM objects;
- React objects;
- Konva instances;
- filesystem handles;
- Electron/Tauri objects;
- platform-specific pointers.

It therefore remains portable across Unifia targets including:

- browser;
- desktop;
- tablet;
- mobile;
- headless agent/runtime processing.

The interactive renderer MAY vary by platform later without changing document semantics.

---

# 24. Alternatives considered

## Keep the current iframe / embedded editor

**Rejected as the target architecture.**

It prevents Unifia from cleanly owning document semantics and makes Phase 7 increasingly dependent on opaque state.

The iframe can remain temporarily only as a migration bridge.

## Use Excalidraw's scene format as the Unifia format

**Rejected.**

Excalidraw is optimized around its own whiteboarding semantics.

Making that schema normative would couple Unifia Design to Excalidraw's product and data-model decisions.

## Use tldraw as both store and runtime

**Not selected for Phase 7.**

tldraw provides an excellent and sophisticated editor architecture, but its store/schema/canvas semantics would become a major architectural dependency.

Unifia requires stronger ownership of its domain model for design-system integration, agent operations and cross-runtime portability.

Parts of its architectural concepts may still inspire future implementation.

## Use Fabric.js

**Viable but not preferred.**

Fabric provides many useful object-model and canvas features.

The primary concern is the temptation to promote Fabric object serialization to the application document model.

It could remain a possible renderer in the future precisely because this ADR makes the renderer replaceable.

## React-Konva in the SolidJS application

**Rejected.**

`packages/app` has no React runtime. Adding React + react-dom + react-reconciler to the app introduces a second reconciler and a second reactive model, contradicts renderer independence, and is unnecessary: Konva's core is framework-agnostic and the adapter is imperative by design.

## Raw SVG / DOM implementation

**Not selected initially.**

SVG is attractive for interoperability and export, but implementing the complete interaction stack—selection, hit testing, complex transforms, handles, snapping and large-scene behavior—would substantially increase Phase 7 implementation scope.

SVG remains a desirable export and potentially alternate rendering target.

---

# 25. Consequences

### Positive

Unifia gains ownership of the Design domain.

The architecture directly enables:

- rotation;
- resize;
- snapping;
- layer DnD;
- hierarchy;
- undo/redo;
- persistence;
- schema migration;
- deterministic testing;
- future collaboration;
- design tokens;
- programmatic editing;
- AI-native design operations;
- renderer replacement.

The model can be manipulated without opening the visual canvas.

### Negative

The native implementation requires more initial work than extending the current iframe.

A renderer adapter and domain mutation layer must be maintained.

Legacy snapshots may require an explicit migration adapter.

Konva is a new runtime dependency; the adapter is lazy-loaded so its bundle cost is paid only when Design mode mounts. The slice-2 PR SHALL record the measured bundle delta as evidence.

### Accepted trade-off

This additional foundation work is accepted because Phase 7 would otherwise accumulate renderer-specific state and require a significantly more dangerous migration later.

---

# 26. Implementation sequence

Phase 7 SHOULD proceed in this dependency order (one GitHub issue per slice):

1. **Design Domain Foundation** — renderer-independent, may start immediately.
   - canonical V1 schema (zod);
   - validation;
   - repository contract;
   - command/reducer layer;
   - migration infrastructure;
   - unit tests (headless).

2. **Native Canvas Foundation** — depends on slice 1.
   - Konva adapter (lazy, client-only);
   - rendering primitives (frame/group/rect/ellipse/line/path/text/image);
   - selection;
   - viewport;
   - drag;
   - resize;
   - rotation.

3. **Interaction Semantics** — depends on slice 2.
   - geometry helpers;
   - snapping;
   - alignment guides;
   - keyboard operations;
   - transaction/history integration.

4. **Layer Runtime** — depends on slices 1-2.
   - canonical hierarchy;
   - deterministic z-order;
   - layer selection;
   - visibility/lock;
   - reorder DnD;
   - reparent DnD;
   - cycle protection;
   - supersede `design-layers-model.ts`.

5. **Legacy transition** — depends on slices 1-4.
   - inspect existing snapshot schema;
   - implement importer where reliable;
   - move current persistence through the canonical repository;
   - remove the iframe once native parity is reached.

---

# 27. Required tests

Implementation SHALL include automated coverage for the architectural invariants.

At minimum:

```text
schema
├ valid V1 accepted
├ malformed V1 rejected
└ unsupported schema version rejected safely

hierarchy
├ reorder deterministic
├ reparent deterministic
├ missing parent rejected
└ hierarchy cycle rejected

transform
├ drag persists
├ resize persists
├ rotate persists
└ save → reload preserves geometry

snapping
├ edge snapping
├ center snapping
└ threshold remains screen-consistent across zoom

history
├ move undo/redo
├ resize undo/redo
├ rotate undo/redo
├ reorder undo/redo
└ reparent undo/redo

persistence
├ canonical serialization round-trip
├ no renderer objects persisted
└ migration validation

layers
├ model ordering matches render ordering
├ visibility reflected by renderer
└ locking prevents forbidden manipulation
```

Model/commands/validation/history tests MUST run headless, without importing the Konva adapter.

End-to-end coverage SHOULD verify the same operations through the actual Design UI.

---

# 28. Phase 7 acceptance gates

Phase 7 cannot be considered complete until all of the following hold:

**D7-G1 — Canonical document**

Every new Design document uses a validated and explicitly versioned Unifia schema.

**D7-G2 — Renderer isolation**

No Konva/Excalidraw/Fabric-specific serialization forms part of the canonical persistence contract.

**D7-G3 — Native runtime**

The primary Design canvas no longer requires the legacy iframe.

**D7-G4 — Transform completeness**

Move, resize and rotation are represented canonically and survive save/reload.

**D7-G5 — Snapping**

Geometry snapping and guides operate correctly independently of zoom.

**D7-G6 — Layer integrity**

Layer reorder and reparent operations deterministically update both document hierarchy and rendered z-order.

**D7-G7 — Structural safety**

Invalid hierarchy cycles and unsupported parenting operations are rejected by the domain layer.

**D7-G8 — History**

Transform and hierarchy operations participate in undo/redo.

**D7-G9 — Migration**

The document loader has an explicit schema migration path.

Legacy iframe documents are either migrated through a validated adapter or preserved without destructive reinterpretation.

**D7-G10 — Cross-runtime document**

The persisted document contains no runtime objects that prevent headless parsing or future alternate renderers.

**D7-G11 — Legacy model absorption**

`design-layers-model.ts` (and its fabricated `defaultLayers()`), `design-layers-panel.tsx` and `design-vector-tools.tsx` are either deleted or re-implemented against the canonical document — no parallel layer/geometry model survives.

### Relationship to the M3 v110 acceptance matrix

The gates above close the following matrix rows (Design surface): canvas (real runtime), rotate transform, snap/grid, layers DnD (real reorder), undo/redo, plus the vector rows (vector tools, Bézier path) that now have a canonical `LineNodeV1`/`PathNodeV1` to build on. G3 and G9 close the "❌ FAKE — Excalidraw iframe" line.

---

# 29. Non-goals of this ADR

This ADR does not freeze:

- multiplayer collaboration protocol;
- CRDT implementation;
- advanced vector operations (boolean/pathfinder, multi-node transforms, advanced typography);
- prototyping/interactions between screens;
- full component-instance semantics;
- complete Figma import/export;
- final design-token specification;
- GPU/WebGPU renderer;
- multiplayer cursors.

Basic pen/Bézier handle editing operates on `PathNodeV1` and is in Phase 7 scope (matrix row "Design Bézier path").

Those decisions can be layered onto the architecture established here without changing the canonical ownership principle.

---

# 30. Final decision

Unifia SHALL replace the iframe-centric Design architecture with a native, renderer-independent Design document runtime.

The canonical persisted format is an explicit, normalized, versioned Unifia scene graph.

Konva's framework-agnostic core is selected as the initial interactive renderer, isolated behind an adapter, lazy-loaded, and never imported outside the Design surface.

All Design mutations—whether initiated by canvas, Layers UI, keyboard, automation or AI—operate on the canonical document through typed domain operations.

The iframe implementation becomes transitional legacy infrastructure and SHALL be removed after native parity and migration requirements are satisfied.

**This ADR unblocks Phase 7.**

---

## References

- `packages/app/src/pages/workbench/design-sketch-tab.tsx` — legacy iframe + localStorage runtime
- `packages/app/src/pages/workbench/design-layers-model.ts`, `design-layers-panel.tsx`, `design-vector-tools.tsx` — orphaned MVP stubs superseded by this ADR
- `packages/design-sketch/` — Excalidraw embed (legacy)
- `packages/artifact-store`, `packages/artifact-runtime` — ADR-1039 artifact substrate
- `packages/design-system-runtime`, `.unifia/workspace.json` — ADR-1040 design-system contract
- `docs/adr/ADR-1038-design-capabilities.md` — Design capability set
- `docs/ui-reference/v110/M3-ACCEPTANCE-MATRIX.md` — Design surface rows
- `docs/adr/ADR-037-p1-5-session-layout-split-plan.md`, `ADR-038-visual-parity-scope.md` — campaign context
