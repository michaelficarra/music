// Rewrite an image URL to a smaller / thumbnail form where the host supports it.
// Used by the enrichment script (and a one-off migration of existing data) so the
// app loads lighter images in the tier grid. Unknown hosts are returned unchanged.

const DEFAULT_WIDTH = 400;

export function toThumbnail(url: string, width: number = DEFAULT_WIDTH): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url; // not a parseable URL — leave as-is
  }

  const host = u.host.toLowerCase();

  // Wikimedia "Special:FilePath/<File>" → request a scaled thumbnail.
  if (u.pathname.includes("/Special:FilePath/")) {
    u.searchParams.set("width", String(width));
    return u.toString();
  }

  // Wikimedia direct upload URL → route via Special:FilePath for a thumbnail.
  // Handles both full files and existing /thumb/ URLs, on commons or a language wiki.
  if (host === "upload.wikimedia.org") {
    const parts = u.pathname.split("/").filter(Boolean); // wikipedia/<project>[/thumb]/h/hh/File.ext[/Npx-File.ext]
    const project = parts[1] ?? "commons";
    const file = parts.includes("thumb") ? parts[parts.length - 2] : parts[parts.length - 1];
    if (file) {
      const wikiHost = project === "commons" ? "commons.wikimedia.org" : `${project}.wikipedia.org`;
      return `https://${wikiHost}/wiki/Special:FilePath/${file}?width=${width}`;
    }
    return url;
  }

  // Apple artwork (mzstatic) → swap the trailing "WxH<crop>.ext" for a small square.
  if (host.endsWith("mzstatic.com")) {
    return url.replace(/\/\d+x\d+[a-z]{0,3}\.(?:jpe?g|png)$/i, `/${width}x${width}bb.jpg`);
  }

  return url;
}
