"use client";

/**
 * Popup.tsx — Visual area editor for a single ePaper page.
 *
 * Layout: full-screen modal, two-column body.
 *   Left  — scrollable canvas: image rendered full-width at the current zoom
 *           level. Zoom in/out via toolbar buttons or mouse-wheel.
 *   Right — settings panel: area list + selected area properties.
 *
 * Coordinate system:
 *   All EPaperArea x/y/width/height values are stored in *image-native pixels*.
 *   The zoom factor only affects display; it is factored into every
 *   screen↔image conversion so saved coordinates are zoom-independent.
 */

import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import type { EPaperArea, EPaperPage } from "./ePaper";
import Content from "@/components/Content";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_SIZE   = 20;   // image-px — minimum area dimension
const ZOOM_STEP  = 0.15; // zoom increment per click / wheel notch
const ZOOM_MIN   = 0.2;
const ZOOM_MAX   = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

type Handle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

interface DragState {
    areaId:      number;
    type:        "move" | Handle;
    startMouseX: number;
    startMouseY: number;
    startX:      number;
    startY:      number;
    startW:      number;
    startH:      number;
    /** image-px per screen-px at drag-start (accounts for zoom) */
    imgPerPx:    number;
}

interface Props {
    page:    EPaperPage;
    onSave:  (areas: EPaperArea[]) => void;
    onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
}

function makeArea(num: number, imgW: number, imgH: number): EPaperArea {
    const w = Math.round(imgW * 0.15);
    const h = Math.round(imgH * 0.08);
    return {
        number:     num,
        x:          Math.round((imgW - w) / 2),
        y:          Math.round((imgH - h) / 2),
        width:      w,
        height:     h,
        actionType: "popup",
        linkUrl:    "",
        content:    "",
        customId:   "",
    };
}

const HANDLE_POS: Record<Handle, React.CSSProperties & { cursor: string }> = {
    nw: { top: -4,  left: -4,                          cursor: "nw-resize" },
    n:  { top: -4,  left: "calc(50% - 4px)",           cursor: "n-resize"  },
    ne: { top: -4,  right: -4,                         cursor: "ne-resize" },
    e:  { top: "calc(50% - 4px)", right: -4,           cursor: "e-resize"  },
    se: { bottom: -4, right: -4,                       cursor: "se-resize" },
    s:  { bottom: -4, left: "calc(50% - 4px)",         cursor: "s-resize"  },
    sw: { bottom: -4, left: -4,                        cursor: "sw-resize" },
    w:  { top: "calc(50% - 4px)", left: -4,            cursor: "w-resize"  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function EPaperPopup({ page, onSave, onClose }: Props) {

    // ── Areas state ───────────────────────────────────────────────────────────
    const [areas, setAreas] = useState<EPaperArea[]>(() =>
        page.areas.map((a) => ({ ...a }))
    );
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [nextNumber, setNextNumber] = useState<number>(() =>
        page.areas.reduce((m, a) => Math.max(m, a.number), 0) + 1
    );

    // ── Zoom state ────────────────────────────────────────────────────────────
    const [zoom, setZoom] = useState(1);

    const changeZoom = useCallback((delta: number) => {
        setZoom((z) => clamp(Math.round((z + delta) * 100) / 100, ZOOM_MIN, ZOOM_MAX));
    }, []);

    // ── Natural image size ────────────────────────────────────────────────────
    const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

    // ── Refs ──────────────────────────────────────────────────────────────────
    const imgRef      = useRef<HTMLImageElement>(null);
    const canvasRef   = useRef<HTMLDivElement>(null);
    const scrollRef   = useRef<HTMLDivElement>(null);
    const dragRef     = useRef<DragState | null>(null);

    // ── Image load ────────────────────────────────────────────────────────────
    const handleImageLoad = () => {
        if (!imgRef.current) return;
        setNaturalSize({
            w: imgRef.current.naturalWidth,
            h: imgRef.current.naturalHeight,
        });
    };

    // ── Mouse-wheel zoom on the scroll container ──────────────────────────────
    const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        if (!e.ctrlKey && !e.metaKey) return; // only when Ctrl/Cmd held
        e.preventDefault();
        changeZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    }, [changeZoom]);

    // Rendered image dimensions (zoom-scaled)
    const renderedW = naturalSize.w > 0 ? Math.round(naturalSize.w * zoom) : undefined;
    const renderedH = naturalSize.h > 0 ? Math.round(naturalSize.h * zoom) : undefined;

    // Conversion: how many image-native px per rendered px (at current zoom)
    // At zoom=1: 1 screen-px = 1 image-px. At zoom=2: 1 screen-px = 0.5 image-px.
    const imgPerPx = zoom > 0 ? 1 / zoom : 1;

    // ── Unified drag start — mouse + touch ───────────────────────────────────
    const startDrag = (
        clientX: number, clientY: number,
        areaNum: number, type: "move" | Handle
    ) => {
        const area = areas.find((a) => a.number === areaNum)!;
        dragRef.current = {
            areaId:      areaNum,
            type,
            startMouseX: clientX,
            startMouseY: clientY,
            startX:      area.x,
            startY:      area.y,
            startW:      area.width,
            startH:      area.height,
            imgPerPx,
        };
        setSelectedId(areaNum);
    };

    const onMouseDownArea = (e: React.MouseEvent, areaNum: number, type: "move" | Handle) => {
        e.stopPropagation(); e.preventDefault();
        startDrag(e.clientX, e.clientY, areaNum, type);
    };

    const onTouchStartArea = (e: React.TouchEvent, areaNum: number, type: "move" | Handle) => {
        e.stopPropagation();
        const t = e.touches[0];
        startDrag(t.clientX, t.clientY, areaNum, type);
    };

    // ── Shared move logic ─────────────────────────────────────────────────────
    const applyMove = useCallback((clientX: number, clientY: number) => {
        if (!dragRef.current) return;
        const d  = dragRef.current;
        const dx = (clientX - d.startMouseX) * d.imgPerPx;
        const dy = (clientY - d.startMouseY) * d.imgPerPx;
        const maxW = naturalSize.w;
        const maxH = naturalSize.h;

        setAreas((prev) => prev.map((a) => {
            if (a.number !== d.areaId) return a;

            if (d.type === "move") {
                return {
                    ...a,
                    x: clamp(Math.round(d.startX + dx), 0, maxW - a.width),
                    y: clamp(Math.round(d.startY + dy), 0, maxH - a.height),
                };
            }

            let { x, y, width, height } = a;
            const t = d.type as Handle;
            if (t.includes("e")) width  = Math.round(clamp(d.startW + dx, MIN_SIZE, maxW - d.startX));
            if (t.includes("s")) height = Math.round(clamp(d.startH + dy, MIN_SIZE, maxH - d.startY));
            if (t.includes("w")) {
                const nw = clamp(d.startW - dx, MIN_SIZE, d.startX + d.startW);
                x = Math.round(d.startX + d.startW - nw); width = Math.round(nw);
            }
            if (t.includes("n")) {
                const nh = clamp(d.startH - dy, MIN_SIZE, d.startY + d.startH);
                y = Math.round(d.startY + d.startH - nh); height = Math.round(nh);
            }
            return { ...a, x, y, width, height };
        }));
    }, [naturalSize]);

    // ── Global mouse + touch listeners ────────────────────────────────────────
    useEffect(() => {
        const onMouseMove = (e: MouseEvent)      => applyMove(e.clientX, e.clientY);
        const onTouchMove = (e: TouchEvent)      => { if (dragRef.current) { e.preventDefault(); applyMove(e.touches[0].clientX, e.touches[0].clientY); } };
        const onEnd       = ()                   => { dragRef.current = null; };

        window.addEventListener("mousemove",  onMouseMove);
        window.addEventListener("mouseup",    onEnd);
        window.addEventListener("touchmove",  onTouchMove, { passive: false });
        window.addEventListener("touchend",   onEnd);
        return () => {
            window.removeEventListener("mousemove",  onMouseMove);
            window.removeEventListener("mouseup",    onEnd);
            window.removeEventListener("touchmove",  onTouchMove);
            window.removeEventListener("touchend",   onEnd);
        };
    }, [applyMove]);

    // ── Click canvas — deselect when clicking empty space ────────────────────
    // Areas are only added via the Add button, not by clicking the canvas.
    const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest("[data-area]")) return;
        setSelectedId(null);
    };

    // ── Area mutators ─────────────────────────────────────────────────────────
    const updateArea = (num: number, patch: Partial<EPaperArea>) =>
        setAreas((prev) => prev.map((a) => (a.number === num ? { ...a, ...patch } : a)));

    const deleteArea = (num: number) => {
        setAreas((prev) => prev.filter((a) => a.number !== num));
        if (selectedId === num) setSelectedId(null);
    };

    // Convert image-native area rect → screen px (zoom-aware) for rendering
    const toScreen = (a: EPaperArea) => ({
        left:   a.x      * zoom,
        top:    a.y      * zoom,
        width:  a.width  * zoom,
        height: a.height * zoom,
    });

    const selectedArea = areas.find((a) => a.number === selectedId) ?? null;

    // ── Render ────────────────────────────────────────────────────────────────
    const modal = (
        <div className="fixed inset-0 z-9999 flex flex-col bg-black/75 backdrop-blur-sm">
            <div className="flex flex-col h-full bg-white md:rounded-2xl md:m-3 overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5 shrink-0">

                    {/* Left: icon + title */}
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Icon icon="streamline-plump:news-paper" width={18} className="text-indigo-500 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-800 truncate leading-tight">
                                Area Editor
                            </p>
                            <p className="text-xs text-gray-400 truncate leading-tight">
                                {page.title || "Untitled"} — use Add to create areas · drag to move · drag edge to resize
                            </p>
                        </div>
                    </div>

                    {/* Centre: zoom controls */}
                    <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-1.5 py-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => changeZoom(-ZOOM_STEP)}
                            disabled={zoom <= ZOOM_MIN}
                            title="Zoom out  (Ctrl + scroll)"
                            className="flex h-6 w-6 items-center justify-center rounded text-gray-600 transition hover:bg-white hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Icon icon="solar:minus-circle-bold" width={15} />
                        </button>

                        <span className="w-12 text-center text-xs font-mono font-semibold text-gray-600 select-none">
                            {Math.round(zoom * 100)}%
                        </span>

                        <button
                            type="button"
                            onClick={() => changeZoom(ZOOM_STEP)}
                            disabled={zoom >= ZOOM_MAX}
                            title="Zoom in  (Ctrl + scroll)"
                            className="flex h-6 w-6 items-center justify-center rounded text-gray-600 transition hover:bg-white hover:shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Icon icon="solar:add-circle-bold" width={15} />
                        </button>

                        <div className="mx-1 h-4 w-px bg-gray-300" />

                        <button
                            type="button"
                            onClick={() => setZoom(1)}
                            title="Reset zoom"
                            className="flex h-6 items-center justify-center rounded px-1.5 text-[10px] font-semibold text-gray-500 transition hover:bg-white hover:shadow-sm"
                        >
                            1:1
                        </button>
                    </div>

                    {/* Right: save + close */}
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() => onSave(areas)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
                        >
                            <Icon icon="solar:check-circle-bold" width={15} />
                            Save
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-100"
                        >
                            <Icon icon="mdi:close" width={16} />
                        </button>
                    </div>
                </div>

                {/* ── Body ── */}
                <div className="flex flex-1 overflow-hidden min-h-0">

                    {/* ── Canvas panel ── */}
                    <div
                        ref={scrollRef}
                        onWheel={handleWheel}
                        className="flex-1 overflow-auto bg-[#1e1e2e] min-w-0"
                        style={{ cursor: "default" }}
                    >
                        {/* Inner wrapper sizes itself to the zoomed image */}
                        <div className="min-h-full min-w-full flex items-start justify-start p-4">
                            <div
                                ref={canvasRef}
                                className="relative select-none shrink-0"
                                style={{
                                    width:  renderedW ?? "100%",
                                    height: renderedH,
                                    lineHeight: 0,
                                }}
                                onClick={handleCanvasClick}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    ref={imgRef}
                                    src={page.image}
                                    alt={page.title || "ePaper page"}
                                    onLoad={handleImageLoad}
                                    draggable={false}
                                    style={{
                                        width:  renderedW ?? "100%",
                                        height: renderedH,
                                        display: "block",
                                    }}
                                    className="rounded shadow-lg"
                                />

                                {/* ── Areas overlay ── */}
                                {naturalSize.w > 0 && areas.map((area) => {
                                    const r          = toScreen(area);
                                    const isSelected = selectedId === area.number;
                                    return (
                                        <div
                                            key={area.number}
                                            data-area={area.number}
                                            onMouseDown={(e) => onMouseDownArea(e, area.number, "move")}
                                            onTouchStart={(e) => onTouchStartArea(e, area.number, "move")}
                                            onClick={(e) => { e.stopPropagation(); setSelectedId(area.number); }}
                                            style={{
                                                position: "absolute",
                                                left:     r.left,
                                                top:      r.top,
                                                width:    r.width,
                                                height:   r.height,
                                                cursor:   "move",
                                                touchAction: "none",
                                            }}
                                            className={`group rounded ${
                                                isSelected
                                                    ? "ring-2 ring-indigo-400"
                                                    : "ring-2 ring-amber-400"
                                            }`}
                                        >
                                            {/* Fill */}
                                            <div className={`absolute inset-0 rounded ${
                                                isSelected
                                                    ? "bg-indigo-400/35"
                                                    : "bg-amber-300/30 group-hover:bg-amber-300/45"
                                            }`} />

                                            {/* Number badge */}
                                            <span className="absolute -top-3 -left-1 z-10 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white shadow">
                                                {area.number}
                                            </span>

                                            {/* Quick-delete on hover */}
                                            <button
                                                type="button"
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onClick={(e) => { e.stopPropagation(); deleteArea(area.number); }}
                                                title="Delete area"
                                                className="absolute -top-3 -right-1 z-10 hidden h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow group-hover:flex"
                                            >
                                                <Icon icon="mdi:close" width={10} />
                                            </button>

                                            {/* Resize handles — only on selected, larger tap targets on touch */}
                                            {isSelected && (Object.keys(HANDLE_POS) as Handle[]).map((h) => (
                                                <div
                                                    key={h}
                                                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onMouseDownArea(e, area.number, h); }}
                                                    onTouchStart={(e) => { e.stopPropagation(); onTouchStartArea(e, area.number, h); }}
                                                    style={{
                                                        position: "absolute",
                                                        width: 12, height: 12,
                                                        background: "white",
                                                        border: "2px solid #6366f1",
                                                        borderRadius: 2,
                                                        zIndex: 20,
                                                        touchAction: "none",
                                                        ...HANDLE_POS[h],
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* ── Settings panel ── */}
                    <div className="w-72 shrink-0 border-l border-gray-200 bg-white flex flex-col overflow-hidden">

                        {/* Area list */}
                        <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 shrink-0">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                                    Areas ({areas.length})
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (naturalSize.w === 0) return;
                                        const a = makeArea(nextNumber, naturalSize.w, naturalSize.h);
                                        setAreas((prev) => [...prev, a]);
                                        setSelectedId(nextNumber);
                                        setNextNumber((n) => n + 1);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-400"
                                >
                                    <Icon icon="solar:add-circle-bold" width={12} />
                                    Add
                                </button>
                            </div>

                            {areas.length === 0 ? (
                                <p className="text-xs text-gray-400">
                                    Click the image to place an area, or use Add.
                                </p>
                            ) : (
                                <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                                    {areas.map((a) => (
                                        <button
                                            key={a.number}
                                            type="button"
                                            onClick={() => setSelectedId(a.number)}
                                            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                                                selectedId === a.number
                                                    ? "bg-indigo-50 text-indigo-700 font-semibold"
                                                    : "text-gray-600 hover:bg-gray-50"
                                            }`}
                                        >
                                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-600">
                                                {a.number}
                                            </span>
                                            <span className="flex-1 truncate">
                                                {a.actionType === "link"
                                                    ? `Link: ${a.linkUrl || "—"}`
                                                    : a.actionType === "content"
                                                    ? "Content"
                                                    : "Popup"}
                                            </span>
                                            {a.customId && (
                                                <span className="font-mono text-[10px] text-gray-400 truncate max-w-[56px]">
                                                    #{a.customId}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Selected area settings */}
                        <div className="flex-1 overflow-y-auto">
                            {selectedArea ? (
                                <div className="flex flex-col gap-4 p-4">

                                    {/* Area heading */}
                                    <div className="flex items-center gap-2">
                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                                            {selectedArea.number}
                                        </span>
                                        <span className="text-sm font-semibold text-gray-700">
                                            Area {selectedArea.number}
                                        </span>
                                    </div>

                                    {/* Action type toggle */}
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-semibold text-gray-500">Action Type</label>
                                        <div className="flex gap-2">
                                            {(["popup", "link", "content"] as const).map((t) => (
                                                <button
                                                    key={t}
                                                    type="button"
                                                    onClick={() => updateArea(selectedArea.number, { actionType: t })}
                                                    className={`flex-1 rounded-lg border py-2 text-xs font-semibold transition ${
                                                        selectedArea.actionType === t
                                                            ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                                                            : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                                                    }`}
                                                >
                                                    <Icon
                                                        icon={
                                                            t === "popup"   ? "solar:layers-minimalistic-bold" :
                                                            t === "link"    ? "solar:link-bold" :
                                                                              "solar:document-text-bold"
                                                        }
                                                        width={12}
                                                        className="inline mr-1"
                                                    />
                                                    {t === "popup" ? "Popup" : t === "link" ? "Link" : "Content"}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Link URL — shown only when actionType === link */}
                                    {selectedArea.actionType === "link" && (
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-xs font-semibold text-gray-500">Link URL</label>
                                            <input
                                                type="url"
                                                value={selectedArea.linkUrl}
                                                onChange={(e) => updateArea(selectedArea.number, { linkUrl: e.target.value })}
                                                placeholder="https://example.com"
                                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none transition focus:border-indigo-500"
                                            />
                                        </div>
                                    )}

                                    {/* Content editor — shown only when actionType === content */}
                                    {selectedArea.actionType === "content" && (
                                        <div className="flex flex-col gap-1.5">
                                            <Content
                                                label="Content"
                                                content={selectedArea.content ?? ""}
                                                onChange={(v) => updateArea(selectedArea.number, { content: v })}
                                            />
                                        </div>
                                    )}

                                    {/* Custom ID */}
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-semibold text-gray-500">ID / Reference</label>
                                        <input
                                            type="text"
                                            value={selectedArea.customId}
                                            onChange={(e) => updateArea(selectedArea.number, { customId: e.target.value })}
                                            placeholder="e.g. 1-50, product-123 …"
                                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none transition focus:border-indigo-500"
                                        />
                                        <p className="text-[11px] text-gray-400 leading-snug">
                                            Any ID or range. E.g. area 1 covers items&nbsp;
                                            <span className="font-mono">1-50</span>, area 2 covers&nbsp;
                                            <span className="font-mono">51-100</span>, etc.
                                        </p>
                                    </div>

                                    {/* Position readout */}
                                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                                        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                            Position &amp; Size (px)
                                        </span>
                                        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-gray-500">
                                            <span>X: {selectedArea.x}</span>
                                            <span>Y: {selectedArea.y}</span>
                                            <span>W: {selectedArea.width}</span>
                                            <span>H: {selectedArea.height}</span>
                                        </div>
                                    </div>

                                    {/* Delete */}
                                    <button
                                        type="button"
                                        onClick={() => deleteArea(selectedArea.number)}
                                        className="flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-semibold text-red-500 transition hover:bg-red-100"
                                    >
                                        <Icon icon="solar:trash-bin-trash-bold" width={13} />
                                        Delete Area {selectedArea.number}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center text-gray-400">
                                    <Icon icon="solar:cursor-bold" width={32} className="opacity-25" />
                                    <p className="text-xs leading-relaxed">
                                        Click an area on the image or select one from the list above to edit its settings.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return typeof window !== "undefined"
        ? createPortal(modal, document.body)
        : null;
}
