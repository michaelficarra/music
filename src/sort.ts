// The canonical ordering for the artist list: case- and accent-insensitive by
// name, matching how data/artists.csv is maintained. Used by the clipboard
// "Save" export and the add-artist tool so the CSV stays sorted.

export function compareArtistNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}
