import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Post from "@/models/post";
import PostInfo from "@/models/post_info";

export const dynamic = "force-dynamic";

/**
 * GET /api/epaper
 * GET /api/epaper?date=YYYY-MM-DD
 *
 * Without ?date  — returns all published "epaper" posts, newest-first.
 * With    ?date  — returns only the post(s) published on that calendar day
 *                  (UTC midnight → UTC midnight+1). Returns { posts: [] }
 *                  when no edition exists for that date.
 *
 * Response shape:
 * {
 *   posts: Array<{
 *     _id:       string
 *     title:     string
 *     slug:      string
 *     createdAt: string   // ISO
 *     pages: Array<{
 *       id:     string
 *       image:  string
 *       title:  string
 *       areas:  Array<{
 *         number:     number
 *         x:          number
 *         y:          number
 *         width:      number
 *         height:     number
 *         actionType: "popup" | "link"
 *         linkUrl:    string
 *         customId:   string
 *       }>
 *     }>
 *   }>
 * }
 */
export async function GET(req: NextRequest) {
    try {
        await connectDB();

        // ── Optional date filter ────────────────────────────────────────────
        const { searchParams } = req.nextUrl;
        const dateParam = searchParams.get("date"); // "YYYY-MM-DD"

        let dateFilter: Record<string, unknown> = {};
        if (dateParam) {
            const parsed = new Date(dateParam);
            if (!isNaN(parsed.getTime())) {
                // Match the full UTC calendar day
                const dayStart = new Date(Date.UTC(
                    parsed.getUTCFullYear(),
                    parsed.getUTCMonth(),
                    parsed.getUTCDate(),
                ));
                const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
                dateFilter = { createdAt: { $gte: dayStart, $lt: dayEnd } };
            }
        }

        // 1. Matching published epaper posts, newest first
        const rawPosts = await Post.find({
            type:   "epaper",
            status: "published",
            ...dateFilter,
        })
            .sort({ createdAt: -1 })
            .lean<any[]>();

        if (rawPosts.length === 0) {
            return NextResponse.json({ posts: [] });
        }

        // 2. Fetch _epaper info for every post in one query
        const postIds = rawPosts.map((p) => p._id);
        const infoRecords = await PostInfo.find({
            postId: { $in: postIds },
            name:   "_epaper",
        }).lean<any[]>();

        // postId (string) → raw JSON value
        const infoMap = new Map<string, string>();
        infoRecords.forEach((r) => {
            infoMap.set(String(r.postId), r.value ?? "");
        });

        // 3. Assemble response
        const posts = rawPosts.map((p) => {
            const raw = infoMap.get(String(p._id)) ?? "";
            let pages: any[] = [];
            try {
                const blob = JSON.parse(raw);
                if (Array.isArray(blob.pages)) pages = blob.pages;
            } catch { /* leave pages as [] */ }

            return {
                _id:       String(p._id),
                title:     p.title     ?? "",
                slug:      p.slug      ?? "",
                createdAt: p.createdAt instanceof Date
                    ? p.createdAt.toISOString()
                    : String(p.createdAt ?? ""),
                pages,
            };
        });

        return NextResponse.json({ posts });
    } catch (err) {
        console.error("ePaper API error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
