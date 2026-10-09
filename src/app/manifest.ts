import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Eat or Yeet",
    short_name: "Eat or Yeet",
    description: "Official UK and US food recalls in one place, and a quick way to check a pack against them. A missing match does not tell you whether food is safe to eat.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf5e9",
    theme_color: "#e39b00",
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" }
    ]
  };
}
