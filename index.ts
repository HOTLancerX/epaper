import { addHook, addPostType, type PluginMeta } from "@/hook";
import ePaper from "./ui/ePaper";
import EPaperStaticPage from "./page/ePaper";
import EPaperStaticPages from "./page/ePapers";


export const PLUGINS: PluginMeta = {
    nx:          "com.system.epaper",
    name:        "epaper",
    version:     "1.0.0",
    description: "epaper with dynamic box selection.",
    author:      "System",
    path:        "https://github.com/HOTLancerX/epaper.git",
    icon:        "streamline-plump:news-paper",
    color:       "from-violet-500 to-purple-600",
};

export function register() {
    // ─── Register post & category types ────────────────────────────────────
    addPostType([
        {
            key: "epaper",
            label: "epaper",
            icon: "solar:cart-large-bold",
            color: "from-emerald-500 to-teal-600",
            position: 30,
        },
    ], PLUGINS.nx);

    // ─── Admin nav items ────────────────────────────────────────────────────
    addHook("admin.nav", [
        {
            key: "epaper",
            label: "ePaper",
            icon: "streamline-plump:news-paper",
            slug: "posts/epaper",
            parent: "",
            position: 1,
        },
        {
            key: "epaper-add",
            label: "Add ePaper",
            icon: "",
            slug: "posts/epaper/new",
            parent: "epaper",
            position: 1,
        },
    ], PLUGINS.nx);

    addHook("post.form", [
        {
            key: "_epaper",
            label: "ePaper Pages",
            type: "epaper",
            style: "left",
            position: 1,
            component: ePaper,
        },
    ], PLUGINS.nx);

    // ─── Frontend static page — /epaper ─────────────────────────────────────
    addHook("root.pages", [
        {
            key: "epaper",
            label: "ePaper Style 1",
            type: "epaper",
            slug: "single",
            style: "left",
            position: 10,
            active: true,
            component: EPaperStaticPage,
        },
        {
            key: "epapers",
            label: "ePaper Style 2",
            type: "epaper",
            slug: "single",
            style: "left",
            position: 10,
            active: true,
            component: EPaperStaticPages,
        },
    ], PLUGINS.nx);
}