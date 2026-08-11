// Shared artist-card visuals: the square thumbnail (image or initial placeholder)
// and the name+tags hover tooltip, used by both the tier board's cards (board.ts)
// and the ☁️ artist map's nodes (cloud.ts).

import type { Artist } from "./types";

// Render the no-image fallback into a thumb: the artist's first character.
// Used both for artists shipped without an image and when a curated image URL
// fails to load (see createThumb), so a dead link degrades to the same placeholder
// rather than a broken-image glyph.
function showPlaceholder(thumb: HTMLElement, name: string): void {
  thumb.classList.add("placeholder");
  thumb.textContent = name.slice(0, 1).toUpperCase();
}

/** Build an artist's square thumbnail: its image, or the initial placeholder. */
export function createThumb(artist: Artist): HTMLElement {
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (artist.imageURL) {
    const img = document.createElement("img");
    img.src = artist.imageURL;
    img.alt = artist.name;
    img.loading = "lazy";
    // A rotted/unreachable URL falls back to the initial placeholder.
    img.addEventListener("error", () => {
      img.remove();
      showPlaceholder(thumb, artist.name);
    });
    thumb.appendChild(img);
  } else {
    showPlaceholder(thumb, artist.name);
  }
  return thumb;
}

/**
 * Native hover tooltip text: the name, plus the tags the artist's row actually
 * names when it has any.
 *
 * `specificTags` rather than `tags`, because the broad ones say nothing while
 * taking the most room: every guitar band's tooltip would trail `punk rock,
 * rock` after its actual genres, and every Angeleno would read `California,
 * American, North American`. Finding artists by those is what the 🎲 filter is
 * for; a tooltip is glanced at, so it gets only the tags that distinguish.
 */
export function artistTooltip(artist: Artist): string {
  return artist.specificTags.length > 0
    ? `${artist.name}\n${artist.specificTags.join(", ")}`
    : artist.name;
}
