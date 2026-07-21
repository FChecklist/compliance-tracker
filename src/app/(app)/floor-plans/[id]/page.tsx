"use client";

export const dynamic = "force-dynamic";

// Wave 6 batch 2 (compliance-tracker/PROJEXA merge): the real 2D floor plan
// editor -- draw room polygons, assign floor/wall/ceiling materials, place
// and drag/rotate FF&E items. Ported directly from PROJEXA's own
// FloorPlanEditorClient.tsx, which is itself pure SVG (pointer events on an
// <svg>, no WebGL) -- confirmed by reading that file in full before writing
// this one. This is the entire real editor, not a stripped-down stand-in:
// polygon drawing, per-room material pickers, drag-to-position + rotate-15
// on placements, all backed by the real interior-floorplan-service.ts
// endpoints.
//
// THE ONE THING DELIBERATELY NOT PORTED: the "3D Walkthrough" button/route.
// PROJEXA's reference links to /floor-plans/[id]/walkthrough, whose client
// component dynamically imports a react-three-fiber <Canvas> (confirmed via
// grep: @react-three/fiber, @react-three/drei and three are real deps in
// PROJEXA's package.json). Grepped this repo's own package.json before
// writing this file -- none of the three are present. Adding ~3 new
// dependencies (three.js's WebGL renderer + fiber's React reconciler + drei's
// helper library) to compliance-tracker's main app bundle is a real,
// disclosable scope decision (bundle size, a new rendering paradigm this
// codebase has never used, ongoing maintenance surface), not something to
// silently pull in mid-page-port. Per this wave's brief: build the
// strongest 2D/data-management version (this file, in full) and flag 3D
// rendering as deferred pending that dependency decision -- see this PR's
// description. GET .../scene (the endpoint the 3D client would consume) is
// untouched server-side and ready the moment that decision is made.
//
// Materials: PROJEXA's own editor has no material-creation UI either (only
// read-only Select dropdowns sourced from GET /design-materials) --
// confirmed by grep across PROJEXA's whole source tree, zero hits for a
// materials-management page. Left as-is would be a dead end for any
// brand-new org (empty dropdowns, no path to populate them), so this port
// adds one small "Quick Add Material" dialog on top of the reference,
// using the already-existing createMaterial() service function that
// PROJEXA's own /api/design-materials POST already calls -- not a new
// backend capability, just a UI path to a capability that already existed
// with literally zero UI anywhere.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Pencil, Trash2, RotateCw, Box, X, Plus } from "lucide-react";

type Point = { x: number; y: number };
type Material = { id: string; name: string; category: string; colorHex: string };
type Room = {
  id: string; name: string; polygon: Point[]; ceilingHeightCm: string;
  floorMaterialId: string | null; wallMaterialId: string | null; ceilingMaterialId: string | null;
  floorMaterial: Material | null; wallMaterial: Material | null; ceilingMaterial: Material | null;
};
type Placement = {
  id: string; roomId: string | null; ffeItemId: string; x: string; y: string; rotationDeg: string;
  item: { id: string; itemName: string; category: string; widthCm: string | null; depthCm: string | null } | null;
};
type FloorPlan = { id: string; name: string; projectId: string; status: string; rooms: Room[]; placements: Placement[] };
type FfeItem = { id: string; itemName: string; category: string };

const CATEGORY_COLORS: Record<string, string> = {
  furniture: "#F5820A", fixture: "#0E7C6E", equipment: "#3B82F6",
  finish: "#A855F7", textile: "#EC4899", lighting: "#EAB308", other: "#94A3B8",
};
const MATERIAL_CATEGORIES = ["flooring", "wall", "ceiling"];

function hexWithAlpha(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16) || 200, g = parseInt(hex.slice(3, 5), 16) || 200, b = parseInt(hex.slice(5, 7), 16) || 200;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const y = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x, y };
}

export default function FloorPlanEditorPage() {
  const params = useParams<{ id: string }>();
  const floorPlanId = params.id;

  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [ffeItems, setFfeItems] = useState<FfeItem[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawMode, setDrawMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState<Point[]>([]);
  const [namingRoom, setNamingRoom] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<{ placementId: string; offsetX: number; offsetY: number } | null>(null);

  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [materialName, setMaterialName] = useState("");
  const [materialCategory, setMaterialCategory] = useState("flooring");
  const [materialColor, setMaterialColor] = useState("#cccccc");
  const [creatingMaterial, setCreatingMaterial] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projexa/floor-plans/${floorPlanId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      const data: FloorPlan = await res.json();
      setFloorPlan(data);
      const [ffeRes, matRes] = await Promise.all([
        fetch(`/api/v1/projexa/ffe?projectId=${encodeURIComponent(data.projectId)}`),
        fetch(`/api/v1/projexa/design-materials`),
      ]);
      const ffeData = await ffeRes.json();
      const matData = await matRes.json();
      setFfeItems(ffeData.items ?? []);
      setMaterials(matData.materials ?? []);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to load floor plan");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [floorPlanId]);

  function toSvgPoint(e: React.PointerEvent | PointerEvent): Point {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  function handleCanvasClick(e: React.PointerEvent<SVGSVGElement>) {
    if (drawMode) {
      setDrawPoints((prev) => [...prev, toSvgPoint(e)]);
    } else {
      setSelectedPlacementId(null);
    }
  }

  async function finishRoom() {
    if (!roomName.trim() || drawPoints.length < 3) return;
    try {
      const res = await fetch(`/api/v1/projexa/floor-plans/${floorPlanId}/rooms`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roomName, polygon: drawPoints }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Room added");
      setDrawPoints([]); setDrawMode(false); setNamingRoom(false); setRoomName("");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to add room");
    }
  }

  async function removeRoom(roomId: string) {
    try {
      const res = await fetch(`/api/v1/projexa/floor-plans/${floorPlanId}/rooms/${roomId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to remove room");
    }
  }

  async function setRoomMaterial(roomId: string, field: "floorMaterialId" | "wallMaterialId" | "ceilingMaterialId", materialId: string) {
    try {
      const res = await fetch(`/api/v1/projexa/floor-plans/${floorPlanId}/rooms/${roomId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: materialId }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to update material");
    }
  }

  async function placeFurniture(ffeItemId: string) {
    if (!floorPlan) return;
    const firstRoom = floorPlan.rooms[0];
    const pos = firstRoom ? centroid(firstRoom.polygon) : { x: 200, y: 200 };
    try {
      const res = await fetch(`/api/v1/projexa/floor-plans/${floorPlanId}/placements`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ffeItemId, roomId: firstRoom?.id, x: pos.x, y: pos.y }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to place item");
    }
  }

  function startDrag(e: React.PointerEvent, p: Placement) {
    e.stopPropagation();
    if (drawMode) return;
    const pt = toSvgPoint(e);
    draggingRef.current = { placementId: p.id, offsetX: pt.x - Number(p.x), offsetY: pt.y - Number(p.y) };
    setSelectedPlacementId(p.id);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current || !floorPlan) return;
    const pt = toSvgPoint(e);
    const newX = pt.x - draggingRef.current.offsetX;
    const newY = pt.y - draggingRef.current.offsetY;
    setFloorPlan({
      ...floorPlan,
      placements: floorPlan.placements.map((pl) =>
        pl.id === draggingRef.current!.placementId ? { ...pl, x: String(newX), y: String(newY) } : pl
      ),
    });
  }

  async function handlePointerUp() {
    if (!draggingRef.current || !floorPlan) return;
    const { placementId } = draggingRef.current;
    draggingRef.current = null;
    const placement = floorPlan.placements.find((p) => p.id === placementId);
    if (!placement) return;
    try {
      await fetch(`/api/v1/projexa/floor-plans/${floorPlanId}/placements/${placementId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: Number(placement.x), y: Number(placement.y) }),
      });
    } catch {
      toast.error("Failed to save position");
    }
  }

  async function rotateSelected() {
    if (!selectedPlacementId || !floorPlan) return;
    const placement = floorPlan.placements.find((p) => p.id === selectedPlacementId);
    if (!placement) return;
    const nextRotation = (Number(placement.rotationDeg) + 15) % 360;
    try {
      const res = await fetch(`/api/v1/projexa/floor-plans/${floorPlanId}/placements/${selectedPlacementId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotationDeg: nextRotation }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Failed to rotate item");
    }
  }

  async function removeSelected() {
    if (!selectedPlacementId) return;
    try {
      const res = await fetch(`/api/v1/projexa/floor-plans/${floorPlanId}/placements/${selectedPlacementId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setSelectedPlacementId(null);
      load();
    } catch {
      toast.error("Failed to remove item");
    }
  }

  async function createMaterial() {
    if (!materialName.trim()) return;
    setCreatingMaterial(true);
    try {
      const res = await fetch("/api/v1/projexa/design-materials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: materialName, category: materialCategory, colorHex: materialColor }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed");
      toast.success("Material added");
      setMaterialDialogOpen(false);
      setMaterialName(""); setMaterialCategory("flooring"); setMaterialColor("#cccccc");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Failed to add material");
    } finally {
      setCreatingMaterial(false);
    }
  }

  if (loading || !floorPlan) return <p className="text-sm text-ct-muted">Loading...</p>;

  const allPoints = [
    ...floorPlan.rooms.flatMap((r) => r.polygon),
    ...floorPlan.placements.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
    ...drawPoints,
  ];
  const minX = allPoints.length ? Math.min(...allPoints.map((p) => p.x)) - 100 : 0;
  const minY = allPoints.length ? Math.min(...allPoints.map((p) => p.y)) - 100 : 0;
  const maxX = allPoints.length ? Math.max(...allPoints.map((p) => p.x)) + 100 : 600;
  const maxY = allPoints.length ? Math.max(...allPoints.map((p) => p.y)) + 100 : 600;

  const unplacedItems = ffeItems.filter((i) => !floorPlan.placements.some((p) => p.ffeItemId === i.id));
  const floorMaterials = materials.filter((m) => m.category === "flooring");
  const wallMaterials = materials.filter((m) => m.category === "wall");
  const ceilingMaterials = materials.filter((m) => m.category === "ceiling");

  return (
    <div className="space-y-4">
      <Link href="/floor-plans" className="inline-flex items-center gap-1 text-xs text-ct-muted hover:text-ct-navy">
        <ArrowLeft className="size-3.5" /> Back to Floor Plans
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="rounded-xl shadow-card bg-white">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base text-ct-navy">{floorPlan.name}</CardTitle>
            <div className="flex gap-2">
              {drawMode ? (
                <>
                  <Button size="sm" variant="secondary" disabled={drawPoints.length < 3} onClick={() => setNamingRoom(true)}>Finish Room ({drawPoints.length} pts)</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setDrawMode(false); setDrawPoints([]); }}><X className="size-3.5 mr-1" /> Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setDrawMode(true)}><Pencil className="size-3.5 mr-1" /> Draw Room</Button>
              )}
              <Button size="sm" variant="outline" disabled title="3D walkthrough needs three.js/react-three-fiber -- deferred, see PR description">
                <Box className="size-3.5 mr-1" /> 3D (deferred)
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {drawMode && <p className="mb-2 text-xs text-ct-muted">Click to add points (min 3), then &quot;Finish Room&quot;.</p>}
            <svg
              ref={svgRef}
              viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
              className="h-[600px] w-full rounded-lg border border-ct-border bg-ct-cloud/20"
              onPointerDown={handleCanvasClick}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {floorPlan.rooms.map((r) => (
                <g key={r.id}>
                  <polygon
                    points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={hexWithAlpha(r.floorMaterial?.colorHex ?? "#cccccc", 0.35)}
                    stroke="#1C2B3A" strokeWidth={4}
                  />
                  <text x={centroid(r.polygon).x} y={centroid(r.polygon).y} textAnchor="middle" fontSize={16} fill="#1C2B3A" fontWeight={600}>{r.name}</text>
                </g>
              ))}

              {drawPoints.length > 0 && (
                <polyline
                  points={drawPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none" stroke="#F5820A" strokeWidth={3} strokeDasharray="6 4"
                />
              )}
              {drawPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={5} fill="#F5820A" />)}

              {floorPlan.placements.map((p) => {
                const w = Number(p.item?.widthCm ?? 60);
                const d = Number(p.item?.depthCm ?? 60);
                const x = Number(p.x), y = Number(p.y);
                const rot = Number(p.rotationDeg);
                const color = CATEGORY_COLORS[p.item?.category ?? "other"];
                const isSelected = selectedPlacementId === p.id;
                return (
                  <g key={p.id} transform={`rotate(${rot} ${x} ${y})`} onPointerDown={(e) => startDrag(e, p)} className="cursor-move">
                    <rect
                      x={x - w / 2} y={y - d / 2} width={w} height={d} rx={4}
                      fill={color} fillOpacity={0.75}
                      stroke={isSelected ? "#F5820A" : "#1C2B3A"} strokeWidth={isSelected ? 4 : 1.5}
                    />
                    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#fff">{p.item?.itemName}</text>
                  </g>
                );
              })}
            </svg>

            {selectedPlacementId && (
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={rotateSelected}><RotateCw className="size-3.5 mr-1" /> Rotate 15&deg;</Button>
                <Button size="sm" variant="outline" onClick={removeSelected}><Trash2 className="size-3.5 mr-1" /> Remove</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm text-ct-navy">Rooms</CardTitle>
              <Dialog open={materialDialogOpen} onOpenChange={setMaterialDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="ghost" title="Add a floor/wall/ceiling material"><Plus className="size-3.5" /> Material</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Quick Add Material</DialogTitle><DialogDescription>Flooring/wall/ceiling swatch for the material pickers below.</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-ct-muted uppercase">Name</Label>
                      <Input value={materialName} onChange={(e) => setMaterialName(e.target.value)} placeholder="e.g. Oak Engineered Wood" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Category</Label>
                        <Select value={materialCategory} onValueChange={setMaterialCategory}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{MATERIAL_CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-ct-muted uppercase">Color</Label>
                        <Input type="color" value={materialColor} onChange={(e) => setMaterialColor(e.target.value)} className="h-9 p-1" />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={createMaterial} disabled={creatingMaterial || !materialName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                      {creatingMaterial ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                      Add Material
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-3">
              {floorPlan.rooms.length === 0 && <p className="text-xs text-ct-muted">No rooms yet -- draw one on the canvas.</p>}
              {floorPlan.rooms.map((r) => (
                <div key={r.id} className="space-y-1.5 rounded-lg border border-ct-border p-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-ct-navy">{r.name}</p>
                    <Button size="sm" variant="ghost" onClick={() => removeRoom(r.id)}><Trash2 className="size-3.5" /></Button>
                  </div>
                  <Select value={r.floorMaterialId ?? undefined} onValueChange={(v) => setRoomMaterial(r.id, "floorMaterialId", v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Floor material" /></SelectTrigger>
                    <SelectContent>{floorMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={r.wallMaterialId ?? undefined} onValueChange={(v) => setRoomMaterial(r.id, "wallMaterialId", v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Wall material" /></SelectTrigger>
                    <SelectContent>{wallMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={r.ceilingMaterialId ?? undefined} onValueChange={(v) => setRoomMaterial(r.id, "ceilingMaterialId", v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Ceiling material" /></SelectTrigger>
                    <SelectContent>{ceilingMaterials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-card bg-white">
            <CardHeader><CardTitle className="text-sm text-ct-navy">Unplaced FF&amp;E Items</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {unplacedItems.length === 0 && <p className="text-xs text-ct-muted">All items placed, or none specified yet -- add items on the FF&amp;E page.</p>}
              {unplacedItems.map((i) => (
                <div key={i.id} className="flex items-center justify-between rounded-lg border border-ct-border p-2">
                  <span className="text-xs text-ct-navy">{i.itemName}</span>
                  <Button size="sm" variant="outline" onClick={() => placeFurniture(i.id)}>Place</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={namingRoom} onOpenChange={setNamingRoom}>
        <DialogContent>
          <DialogHeader><DialogTitle>Name this room</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-ct-muted uppercase">Room Name</Label>
            <Input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="e.g. Living Room" />
          </div>
          <DialogFooter>
            <Button onClick={finishRoom} disabled={!roomName.trim()} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white">Add Room</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
