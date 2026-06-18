"use client";

/**
 * ePaper.tsx — Dynamic list of ePaper pages for the epaper post form.
 *
 * Follows the same local-state + flush pattern as Variate.tsx:
 *   - State is seeded from `value` once on mount via useState initialiser.
 *   - Every mutation updates local state then calls flush() immediately.
 *   - No useEffect re-reads value — avoids the stale-closure loop that
 *     occurs when every keystroke round-trips through PostForm → info[key]
 *     → JSON.parse → re-render.
 *
 * Each ePaper page entry has:
 *   - Image  (Gallery picker)
 *   - Title  (text input)
 *   - Up / Down reorder buttons
 *   - Edit button → opens Popup (visual area editor)
 *   - Remove button
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { FieldProps } from "@/hook";
import Gallery from "@/components/Gallery";
import EPaperPopup from "./Popup";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EPaperArea {
    /** Auto-incrementing display number, 1-based */
    number: number;
    /** Position / size stored in image-native pixels */
    x: number;
    y: number;
    width: number;
    height: number;
    /** What happens when a visitor clicks this area */
    actionType: "popup" | "link" | "content";
    /** URL — only relevant when actionType === "link" */
    linkUrl: string;
    /** Rich-text HTML — only relevant when actionType === "content" */
    content: string;
    /** Free-form reference ID set by the editor */
    customId: string;
}

export interface EPaperPage {
    id: string;
    image: string;
    title: string;
    areas: EPaperArea[];
}

interface EPaperState {
    pages: EPaperPage[];
}

const DEFAULT_STATE: EPaperState = { pages: [] };

function parseBlob(raw: string): EPaperState {
    if (!raw) return { ...DEFAULT_STATE };
    try { return { ...DEFAULT_STATE, ...JSON.parse(raw) }; }
    catch { return { ...DEFAULT_STATE }; }
}

function makeId() {
    return `ep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EPaper({ name, label, value, onChange }: FieldProps) {

    // ── Local state — seeded from `value` once on mount ───────────────────────
    const [pages, setPages] = useState<EPaperPage[]>(() => parseBlob(value).pages);

    // Initialise from parent only once (same guard pattern as Variate.tsx)
    const initialised = useRef(false);
    useEffect(() => {
        if (initialised.current) return;
        initialised.current = true;
        const s = parseBlob(value);
        setPages(s.pages);
    }, [value]);

    // Which page is currently open in the popup editor
    const [editingPageId, setEditingPageId] = useState<string | null>(null);

    // ── Flush to parent ───────────────────────────────────────────────────────
    const flush = useCallback(
        (nextPages: EPaperPage[]) => {
            onChange(JSON.stringify({ pages: nextPages }));
        },
        [onChange]
    );

    // ── Mutators ──────────────────────────────────────────────────────────────

    const addPage = () => {
        const next: EPaperPage[] = [
            ...pages,
            { id: makeId(), image: "", title: "", areas: [] },
        ];
        setPages(next);
        flush(next);
    };

    const removePage = (id: string) => {
        const next = pages.filter((p) => p.id !== id);
        setPages(next);
        flush(next);
    };

    const moveUp = (index: number) => {
        if (index === 0) return;
        const next = [...pages];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        setPages(next);
        flush(next);
    };

    const moveDown = (index: number) => {
        if (index === pages.length - 1) return;
        const next = [...pages];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        setPages(next);
        flush(next);
    };

    const updatePage = (id: string, patch: Partial<EPaperPage>) => {
        const next = pages.map((p) => (p.id === id ? { ...p, ...patch } : p));
        setPages(next);
        flush(next);
    };

    // Called by Popup when the user clicks Save
    const saveAreas = (pageId: string, areas: EPaperArea[]) => {
        updatePage(pageId, { areas });
        setEditingPageId(null);
    };

    const editingPage = pages.find((p) => p.id === editingPageId) ?? null;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-4">

            {/* ── Section header ── */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {label}
                </span>
                <button
                    type="button"
                    onClick={addPage}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-400"
                >
                    <Icon icon="solar:add-circle-bold" width={14} />
                    Add Page
                </button>
            </div>

            {/* ── Empty state ── */}
            {pages.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
                    No pages yet — click{" "}
                    <span className="font-medium text-indigo-500">Add Page</span> to begin.
                </div>
            )}

            {/* ── Page cards ── */}
            <div className="flex flex-col gap-3">
                {pages.map((page, index) => (
                    <div
                        key={page.id}
                        className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
                    >
                        {/* Toolbar row */}
                        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">

                            {/* Page number badge */}
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-600">
                                {index + 1}
                            </span>

                            {/* Title preview */}
                            <span className="flex-1 truncate text-xs font-medium text-gray-600">
                                {page.title || (
                                    <span className="italic text-gray-400">Untitled</span>
                                )}
                            </span>

                            {/* Up */}
                            <button
                                type="button"
                                onClick={() => moveUp(index)}
                                disabled={index === 0}
                                title="Move up"
                                className="flex h-6 w-6 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <Icon icon="solar:arrow-up-bold" width={12} />
                            </button>

                            {/* Down */}
                            <button
                                type="button"
                                onClick={() => moveDown(index)}
                                disabled={index === pages.length - 1}
                                title="Move down"
                                className="flex h-6 w-6 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <Icon icon="solar:arrow-down-bold" width={12} />
                            </button>

                            {/* Edit (opens Popup) */}
                            <button
                                type="button"
                                onClick={() => setEditingPageId(page.id)}
                                disabled={!page.image}
                                title={page.image ? "Edit interactive areas" : "Select an image first"}
                                className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Icon icon="solar:pen-bold" width={12} />
                                Edit
                                {page.areas.length > 0 && (
                                    <span className="ml-0.5 rounded-full bg-amber-200 px-1 text-[10px] font-bold text-amber-800">
                                        {page.areas.length}
                                    </span>
                                )}
                            </button>

                            {/* Remove */}
                            <button
                                type="button"
                                onClick={() => removePage(page.id)}
                                title="Remove page"
                                className="flex h-6 w-6 items-center justify-center rounded border border-red-200 bg-red-50 text-red-500 transition hover:bg-red-100"
                            >
                                <Icon icon="solar:trash-bin-trash-bold" width={12} />
                            </button>
                        </div>

                        {/* Content row */}
                        <div className="grid grid-cols-[120px_1fr] gap-4 p-3">

                            {/* Image */}
                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-500">Image</span>
                                <Gallery
                                    value={page.image}
                                    onChange={(v) =>
                                        updatePage(page.id, {
                                            image: Array.isArray(v) ? (v[0] ?? "") : v,
                                        })
                                    }
                                    placeholder="Pick image"
                                />
                            </div>

                            {/* Title + hints */}
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-gray-500">Title</label>
                                <input
                                    type="text"
                                    value={page.title}
                                    onChange={(e) =>
                                        updatePage(page.id, { title: e.target.value })
                                    }
                                    placeholder="Page title…"
                                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-500"
                                />
                                {page.areas.length > 0 && (
                                    <p className="text-xs text-gray-400">
                                        {page.areas.length} interactive area
                                        {page.areas.length !== 1 ? "s" : ""} defined
                                    </p>
                                )}
                                {page.image && page.areas.length === 0 && (
                                    <p className="text-xs text-amber-500">
                                        No areas yet — click Edit to add them
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Popup area editor (portal) ── */}
            {editingPage && (
                <EPaperPopup
                    page={editingPage}
                    onSave={(areas) => saveAreas(editingPage.id, areas)}
                    onClose={() => setEditingPageId(null)}
                />
            )}
        </div>
    );
}
