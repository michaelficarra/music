import { describe, expect, it } from "vitest";
import { groupTags } from "./tag-groups";

describe("groupTags", () => {
  it("partitions tags into labelled groups in display order", () => {
    const groups = groupTags(["2000s", "emo", "duo", "male vocals", "1990s"]);
    expect(groups).toEqual([
      { label: "Genres", tags: ["emo"] },
      { label: "Musical qualities", tags: ["male vocals"] },
      { label: "Eras", tags: ["2000s", "1990s"] },
      { label: "Notable aspects", tags: ["duo"] },
    ]);
  });

  it("recognises any decade-shaped tag as an era", () => {
    expect(groupTags(["1890s"])).toEqual([{ label: "Eras", tags: ["1890s"] }]);
  });

  it("collects unrecognised tags into a trailing Other group", () => {
    const groups = groupTags(["emo", "brand-new tag"]);
    expect(groups.at(-1)).toEqual({ label: "Other", tags: ["brand-new tag"] });
  });

  it("omits empty groups and preserves input order within a group", () => {
    const groups = groupTags(["ska punk", "emo", "Celtic punk"]);
    expect(groups).toEqual([{ label: "Genres", tags: ["ska punk", "emo", "Celtic punk"] }]);
  });
});
