"use client";

/**
 * plugin/epaper/page/ePaper.tsx
 *
 * Single self-contained client component for the ePaper frontend.
 * Registered in root.pages as slug="single", key="epaper" → URL: /epaper
 *
 * On mount it fetches /api/epaper directly and renders:
 *
 *   Date search bar — day / month / year dropdowns + Search button.
 *                     Submitting fetches /api/epaper?date=YYYY-MM-DD.
 *                     "Show all" clears the filter and reloads the full list.
 *
 *   Left sidebar    — list of all epaper posts (title + full date).
 *                     Most recent is active by default.
 *                     Clicking a date loads that edition.
 *
 *   Right panel     — active post viewer:
 *                     • Tab strip when the post has multiple pages
 *                     • Full-width image with clickable area overlays
 *                     • Area click:
 *                         actionType "popup" → modal dialog
 *                         actionType "link"  → opens linkUrl in new tab
 *                     • If clicked area has a customId range (e.g. "1-50"),
 *                       a "Read next part" button appears that jumps to
 *                       the page whose area range starts at rangeEnd + 1.
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
    const [hovered, setHovered] = useState(false);
    return (
        <div
            onClick={() => onActivate(area)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title={area.actionType === "link" ? area.linkUrl : `Area ${area.number}`}
            style={{
                position:        "absolute",
                left:            area.x      * scale,
                top:             area.y      * scale,
                width:           area.width  * scale,
                height:          area.height * scale,
                cursor:          "pointer",
                zIndex:          10,
                boxSizing:       "border-box",
                borderRadius:    4,
                backgroundColor: (isActive || hovered) ? "rgba(0,0,0,0.5)" : "transparent",
                transition:      "background-color 0.15s",
            }}
        />
    );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
    settings?:    Record<string, any>;
    permalinkMap?: Record<string, string>;
}

export default function EPaperStaticPage({ settings = {} }: Props) {
    const siteName = (settings?.siteName as string) || "ePaper";

    // ── Date search state ─────────────────────────────────────────────────────
    const currentYear = new Date().getFullYear();
    const [searchDay,   setSearchDay]   = useState("");
    const [searchMonth, setSearchMonth] = useState("");
    const [searchYear,  setSearchYear]  = useState("");
    const [dateNotFound, setDateNotFound] = useState(false);

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

    // ── Date search handlers ──────────────────────────────────────────────────
    const handleDateSearch = (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchDay || !searchMonth || !searchYear) return;
        const mm = String(searchMonth).padStart(2, "0");
        const dd = String(searchDay).padStart(2, "0");
        fetchPosts(`${searchYear}-${mm}-${dd}`);
        // Reset active post so the new result becomes selected
        setActivePostId("");
        setActivePageIdx(0);
    };

    const handleShowAll = () => {
        setSearchDay("");
        setSearchMonth("");
        setSearchYear("");
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
        <div className="container">
            {/* ── Date search bar ── */}
            <form
                onSubmit={handleDateSearch}
                className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-gray-50 border border-gray-200 rounded-xl"
            >
                {/* Day */}
                <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Day</label>
                    <select
                        value={searchDay}
                        onChange={(e) => setSearchDay(e.target.value)}
                        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                        <option value="">--</option>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                </div>

                {/* Month */}
                <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Month</label>
                    <select
                        value={searchMonth}
                        onChange={(e) => setSearchMonth(e.target.value)}
                        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                        <option value="">--</option>
                        {[
                            "January","February","March","April","May","June",
                            "July","August","September","October","November","December",
                        ].map((name, idx) => (
                            <option key={idx + 1} value={idx + 1}>{name}</option>
                        ))}
                    </select>
                </div>

                {/* Year */}
                <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Year</label>
                    <select
                        value={searchYear}
                        onChange={(e) => setSearchYear(e.target.value)}
                        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                        <option value="">----</option>
                        {Array.from({ length: 10 }, (_, i) => currentYear - i).map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </div>

                {/* Buttons */}
                <div className="flex items-end gap-2 pb-0.5">
                    <button
                        type="submit"
                        disabled={!searchDay || !searchMonth || !searchYear}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Icon icon="solar:calendar-search-bold" width={16} />
                        Search
                    </button>
                    {(searchDay || searchMonth || searchYear) && (
                        <button
                            type="button"
                            onClick={handleShowAll}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
                        >
                            Show all
                        </button>
                    )}
                </div>
            </form>

            {/* ── date-not-found notice ── */}
            {dateNotFound && (
                <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">
                    <Icon icon="solar:calendar-bold" width={18} className="shrink-0" />
                    No edition found for{" "}
                    {searchDay}/{searchMonth}/{searchYear}.
                    <button
                        type="button"
                        onClick={handleShowAll}
                        className="ml-auto text-xs font-semibold underline underline-offset-2"
                    >
                        Show all
                    </button>
                </div>
            )}

            {/* ── page viewer ── */}
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
                            <div className="flex items-center justify-center gap-2 border-b border-gray-200 bg-white px-4 py-2 overflow-x-auto shrink-0">
                                {activePost.pages.map((page, idx) => {
                                    const isActive = idx === activePageIdx;
                                    return (
                                        <button
                                            key={page.id}
                                            type="button"
                                            onClick={() => { setActivePageIdx(idx); setActiveArea(null); }}
                                            className={`shrink-0 flex flex-col justify-center items-center gap-1 rounded-lg p-1.5 transition border-2 ${
                                                isActive
                                                    ? "border-indigo-500 bg-indigo-50"
                                                    : "border-transparent bg-gray-50 hover:border-gray-300 hover:bg-gray-100"
                                            }`}
                                        >
                                            {/* Thumbnail */}
                                            {page.image ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={page.image}
                                                    alt={page.title || `Page ${idx + 1}`}
                                                    className="w-16 h-30 object-cover rounded"
                                                    draggable={false}
                                                />
                                            ) : (
                                                <div className="w-16 h-10 rounded bg-gray-200 flex items-center justify-center">
                                                    <Icon icon="solar:image-bold" width={16} className="text-gray-400" />
                                                </div>
                                            )}
                                            {/* Title */}
                                            <span className={`text-[11px] font-medium max-w-[64px] truncate leading-tight ${
                                                isActive ? "text-indigo-700" : "text-gray-600"
                                            }`}>
                                                {page.title || `Page ${idx + 1}`}
                                            </span>
                                        </button>
                                    );
                                })}
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
