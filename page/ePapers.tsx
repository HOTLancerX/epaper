"use client";

/**
 * plugin/epaper/page/ePaper.tsx
 *
 * Single self-contained client component for the ePaper frontend.
 * Registered in root.pages as slug="single", key="epaper" → URL: /epaper
 *
 * On mount it fetches /api/epaper directly and renders:
 *
 *   Left sidebar  — list of all epaper posts (title + full date).
 *                   Most recent is active by default.
 *                   Clicking a date loads that edition.
 *
 *   Right panel   — active post viewer:
 *                   • Tab strip when the post has multiple pages
 *                   • Full-width image with clickable area overlays
 *                   • Area click:
 *                       actionType "popup" → modal dialog
 *                       actionType "link"  → opens linkUrl in new tab
 *                   • If clicked area has a customId range (e.g. "1-50"),
 *                     a "Read next part →" button appears that jumps to
 *                     the page whose area range starts at rangeEnd + 1.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EPaperArea {
    number:     number;
    x:          number;
    y:          number;
    width:      number;
    height:     number;
    actionType: "popup" | "link";
    linkUrl:    string;
    customId:   string;
}

interface EPaperPage {
    id:     string;
    image:  string;
    title:  string;
    areas:  EPaperArea[];
}

interface EPaperPost {
    _id:       string;
    title:     string;
    slug:      string;
    createdAt: string;
    pages:     EPaperPage[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: "numeric", month: "long", day: "numeric",
        });
    } catch { return iso; }
}

/**
 * Given an area with customId like "1-50", find the page that has an area
 * whose range starts at rangeEnd + 1 (e.g. "51").
 */
function findNextPage(area: EPaperArea, pages: EPaperPage[]): EPaperPage | null {
    const m = area.customId.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!m) return null;
    const nextStart = parseInt(m[2], 10) + 1;
    for (const page of pages) {
        for (const a of page.areas) {
            const m2 = a.customId.match(/^(\d+)\s*[-–]/);
            if (m2 && parseInt(m2[1], 10) === nextStart) return page;
        }
    }
    return null;
}

// ── Area overlay ──────────────────────────────────────────────────────────────

interface AreaOverlayProps {
    area:       EPaperArea;
    naturalW:   number;
    containerW: number;
    isActive:   boolean;
    onActivate: (area: EPaperArea) => void;
}

function AreaOverlay({ area, naturalW, containerW, isActive, onActivate }: AreaOverlayProps) {
    if (!naturalW || !containerW) return null;
    const scale = containerW / naturalW;
    return (
        <div
            onClick={() => onActivate(area)}
            title={area.actionType === "link" ? area.linkUrl : `Area ${area.number}`}
            style={{
                position: "absolute",
                left:   area.x      * scale,
                top:    area.y      * scale,
                width:  area.width  * scale,
                height: area.height * scale,
                cursor: "pointer",
                zIndex: 10,
                boxSizing: "border-box",
            }}
            className={`rounded group transition-all ${
                isActive
                    ? "ring-2 ring-black/60"
                    : "hover:ring-2 hover:ring-black/40"
            }`}
        >
            {/* Badge — invisible by default, fades in on hover */}
            <span className="absolute -top-3 -left-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {area.number}
            </span>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
    settings?:    Record<string, any>;
    permalinkMap?: Record<string, string>;
}

export default function EPaperStaticPages({ settings = {} }: Props) {
    const siteName = (settings?.siteName as string) || "ePaper";

    // ── Data fetching ─────────────────────────────────────────────────────────
    const [posts,   setPosts]   = useState<EPaperPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState("");

    const fetchPosts = useCallback((dateStr?: string) => {
        setLoading(true);
        setError("");
        setDateNotFound(false);
        const url = dateStr ? `/api/epaper?date=${dateStr}` : "/api/epaper";
        fetch(url, { cache: "no-store" })
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then((data: { posts: EPaperPost[] }) => {
                const list = data.posts ?? [];
                setPosts(list);
                if (dateStr && list.length === 0) setDateNotFound(true);
            })
            .catch((e) => setError(String(e)))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchPosts(); }, [fetchPosts]);

    // ── Date search state ─────────────────────────────────────────────────────
    const [dateInput,    setDateInput]    = useState("");
    const [dateNotFound, setDateNotFound] = useState(false);

    const handleDateSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (!dateInput) return;
        fetchPosts(dateInput);
        setActivePostId("");
        setActivePageIdx(0);
    };

    const handleClear = () => {
        setDateInput("");
        fetchPosts();
        setActivePostId("");
        setActivePageIdx(0);
    };

    // ── UI state ──────────────────────────────────────────────────────────────
    const [activePostId,  setActivePostId]  = useState<string>("");
    const [activePageIdx, setActivePageIdx] = useState(0);
    const [activeArea,    setActiveArea]    = useState<EPaperArea | null>(null);
    const [popupOpen,     setPopupOpen]     = useState(false);

    // Set first post active once data arrives
    useEffect(() => {
        if (posts.length > 0 && !activePostId) {
            setActivePostId(posts[0]._id);
        }
    }, [posts, activePostId]);

    // Image + img ref for measuring natural size and rendered width
    const imgRef = useRef<HTMLImageElement>(null);
    const [containerW,  setContainerW]  = useState(0);
    const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

    // Attach ResizeObserver to the img element whenever it changes.
    // Using a ref-callback ensures we always observe the current DOM node
    // even when it is replaced (src change / tab switch re-render).
    const roRef = useRef<ResizeObserver | null>(null);
    const imgCallbackRef = useCallback((node: HTMLImageElement | null) => {
        // Disconnect previous observer
        if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
        (imgRef as React.MutableRefObject<HTMLImageElement | null>).current = node;
        if (!node) return;
        roRef.current = new ResizeObserver(() => {
            setContainerW(node.clientWidth);
        });
        roRef.current.observe(node);
        // Read immediately in case the image is already rendered
        if (node.complete && node.naturalWidth > 0) {
            setNaturalSize({ w: node.naturalWidth, h: node.naturalHeight });
            setContainerW(node.clientWidth);
        }
    }, []);

    // When tab or post changes, re-read from the current img if already loaded
    useEffect(() => {
        const img = imgRef.current;
        if (img && img.complete && img.naturalWidth > 0) {
            setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            setContainerW(img.clientWidth);
        } else {
            setNaturalSize({ w: 0, h: 0 });
        }
    }, [activePageIdx, activePostId]);

    // Esc closes popup
    useEffect(() => {
        if (!popupOpen) return;
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") setPopupOpen(false); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [popupOpen]);

    // ── Derived ───────────────────────────────────────────────────────────────
    const activePost = posts.find((p) => p._id === activePostId) ?? posts[0] ?? null;
    const activePage = activePost?.pages[activePageIdx] ?? null;
    const nextPage   = activeArea ? findNextPage(activeArea, activePost?.pages ?? []) : null;
    const nextPageIdx = nextPage ? (activePost?.pages.indexOf(nextPage) ?? -1) : -1;

    // ── Handlers ──────────────────────────────────────────────────────────────
    const selectPost = (id: string) => {
        setActivePostId(id);
        setActivePageIdx(0);
        setActiveArea(null);
        setPopupOpen(false);
    };

    const handleAreaActivate = useCallback((area: EPaperArea) => {
        setActiveArea(area);
        if (area.actionType === "link" && area.linkUrl) {
            window.open(area.linkUrl, "_blank", "noopener,noreferrer");
        } else {
            setPopupOpen(true);
        }
    }, []);

    const goToNextPart = () => {
        if (nextPageIdx < 0) return;
        setActivePageIdx(nextPageIdx);
        setActiveArea(null);
        setPopupOpen(false);
    };

    // ── Loading / error / empty states ────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] gap-3 text-gray-400">
                <Icon icon="mdi:loading" width={24} className="animate-spin" />
                <span className="text-sm">Loading editions…</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] text-red-400 text-sm">
                Failed to load ePaper: {error}
            </div>
        );
    }

    if (posts.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-[60vh] text-gray-400 text-sm">
                No ePaper editions published yet.
            </div>
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col min-h-screen bg-gray-50">

            {/* ── Date search bar ── */}
            <form
                onSubmit={handleDateSearch}
                className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-200"
            >
                <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                    type="submit"
                    disabled={!dateInput}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Icon icon="solar:calendar-search-bold" width={15} />
                    Search
                </button>
                {dateInput && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100"
                    >
                        <Icon icon="mdi:close" width={14} />
                        Clear
                    </button>
                )}
                {dateNotFound && (
                    <span className="text-xs text-amber-600 font-medium">
                        No edition found for this date.
                    </span>
                )}
            </form>

            {/* ── Left sidebar: post / date list ── */}
            <aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-white md:overflow-y-auto">
                {/* Header
                <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Icon icon="streamline-plump:news-paper" width={18} className="text-indigo-500" />
                        <span className="font-bold text-sm text-gray-800">{siteName}</span>
                    </div>
                </div> */}

                {/* Post list
                <div className="flex flex-col divide-y divide-gray-100">
                    {posts.map((post) => {
                        const isActive = post._id === activePostId;
                        return (
                            <button
                                key={post._id}
                                type="button"
                                onClick={() => selectPost(post._id)}
                                className={`w-full text-left px-4 py-3 transition-colors border-l-4 ${
                                    isActive
                                        ? "bg-indigo-50 border-indigo-500"
                                        : "hover:bg-gray-50 border-transparent"
                                }`}
                            >
                                <p className={`text-sm font-semibold leading-tight truncate ${
                                    isActive ? "text-indigo-700" : "text-gray-800"
                                }`}>
                                    {post.title}
                                </p>
                                <p className={`text-xs mt-0.5 ${
                                    isActive ? "text-indigo-500" : "text-gray-400"
                                }`}>
                                    {formatDate(post.createdAt)}
                                </p>
                            </button>
                        );
                    })}
                </div> */}
            </aside>

            {/* ── Right panel: page viewer ── */}
            <main className="flex-1 flex flex-col overflow-hidden">
                {!activePost || activePost.pages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center flex-1 gap-3 py-24 text-gray-400">
                        <Icon icon="streamline-plump:news-paper" width={48} className="opacity-20" />
                        <p className="text-sm">No pages in this edition.</p>
                    </div>
                ) : (
                    <>
                        {/* Page tab strip — only when > 1 page */}
                        {activePost.pages.length > 1 && (
                            <div className="flex items-center gap-1 border-b border-gray-200 bg-white px-4 py-2 overflow-x-auto shrink-0">
                                {activePost.pages.map((page, idx) => (
                                    <button
                                        key={page.id}
                                        type="button"
                                        onClick={() => { setActivePageIdx(idx); setActiveArea(null); }}
                                        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                                            idx === activePageIdx
                                                ? "bg-indigo-500 text-white"
                                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                        }`}
                                    >
                                        {page.title || `Page ${idx + 1}`}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Active page */}
                        {activePage && (
                            <div className="flex flex-col flex-1 overflow-y-auto">
                                {/* Page title
                                {activePage.title && (
                                    <div className="px-4 pt-4 pb-2">
                                        <h2 className="text-lg font-bold text-gray-800">
                                            {activePage.title}
                                        </h2>
                                    </div>
                                )}
                                 */}
                                {/* Image + interactive area overlays */}
                                <div
                                    className="relative mx-4 mb-4 rounded-xl overflow-hidden shadow-md"
                                    style={{ lineHeight: 0 }}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        ref={imgCallbackRef}
                                        src={activePage.image}
                                        alt={activePage.title || activePost.title}
                                        onLoad={(e) => {
                                            const img = e.currentTarget;
                                            setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                                            setContainerW(img.clientWidth);
                                        }}
                                        draggable={false}
                                        className="w-full h-auto block"
                                    />

                                    {naturalSize.w > 0 && activePage.areas.map((area) => (
                                        <AreaOverlay
                                            key={area.number}
                                            area={area}
                                            naturalW={naturalSize.w}
                                            containerW={containerW}
                                            isActive={activeArea?.number === area.number && popupOpen}
                                            onActivate={handleAreaActivate}
                                        />
                                    ))}
                                </div>

                                {/* Read next part button */}
                                {nextPageIdx >= 0 && (
                                    <div className="flex justify-center pb-6">
                                        <button
                                            type="button"
                                            onClick={goToNextPart}
                                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
                                        >
                                            Read next part
                                            <Icon icon="solar:arrow-right-bold" width={16} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* ── Popup modal ── */}
            {popupOpen && activeArea && activeArea.actionType === "popup" && activePage && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                    onClick={() => setPopupOpen(false)}
                >
                    <div
                        className="relative bg-white rounded-xl shadow-xl flex flex-col"
                        style={{ maxWidth: "min(90vw, 720px)", maxHeight: "90vh", width: "100%", overflow: "hidden" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close */}
                        <button
                            type="button"
                            onClick={() => setPopupOpen(false)}
                            className="absolute top-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition"
                        >
                            <Icon icon="mdi:close" width={16} />
                        </button>

                        {/* Scrollable wrapper — scrolls when crop is taller than 90vh */}
                        <div style={{ flex: 1, minHeight: 0, overflowY: "scroll" }}>
                            {(() => {
                                const a = activeArea;
                                const maxW     = typeof window !== "undefined" ? Math.floor(window.innerWidth * 0.9) : 720;
                                const displayW = Math.min(720, maxW);
                                const scale    = displayW / a.width;
                                const displayH = Math.round(a.height * scale);
                                const bgW      = Math.round(naturalSize.w * scale);
                                const bgH      = naturalSize.h > 0 ? Math.round(naturalSize.h * scale) : 0;
                                const bgX      = -Math.round(a.x * scale);
                                const bgY      = -Math.round(a.y * scale);
                                return (
                                    <div
                                        style={{
                                            width:              displayW,
                                            height:             displayH,
                                            backgroundImage:    `url(${activePage.image})`,
                                            backgroundRepeat:   "no-repeat",
                                            backgroundSize:     `${bgW}px ${bgH > 0 ? bgH + "px" : "auto"}`,
                                            backgroundPosition: `${bgX}px ${bgY}px`,
                                        }}
                                    />
                                );
                            })()}
                        </div>

                        {/* Footer: customId + next part */}
                        {(activeArea.customId || nextPageIdx >= 0) && (
                            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50">
                                {activeArea.customId ? (
                                    <span className="text-xs text-gray-400 font-mono">
                                        ID: {activeArea.customId}
                                    </span>
                                ) : <span />}
                                {nextPageIdx >= 0 && (
                                    <button
                                        type="button"
                                        onClick={() => { setPopupOpen(false); goToNextPart(); }}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-400"
                                    >
                                        Read next part
                                        <Icon icon="solar:arrow-right-bold" width={13} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}