import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Eat or Yeet",
    short_name: "Eat or Yeet",
    description: "Scan packaged food and check current official food-safety warnings.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#71852f",
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" }
    ]
  };
}
