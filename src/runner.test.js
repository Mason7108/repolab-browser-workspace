import { describe, expect, it } from "vitest";
import { prepareSandpackFiles, relativeToRoot } from "./runner";

describe("runner file preparation", () => {
  it("makes selected-folder paths workspace-relative", () => {
    expect(relativeToRoot("Fun Game/src/app.js", "Fun Game")).toBe("/src/app.js");
  });

  it("inlines binary assets without corrupting text", () => {
    const html = btoa('<img src="images/pixel.png">');
    const files = prepareSandpackFiles([
      { path: "game/index.html", content: html },
      { path: "game/images/pixel.png", content: "iVBORw0KGgo=" },
    ], "game");
    expect(files["/index.html"].code).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("opens selected files even when index.html is missing", () => {
    const files = prepareSandpackFiles([
      { path: "notes/readme.md", content: btoa("# Project notes") },
    ], "notes");

    expect(files["/readme.md"]).toMatchObject({
      code: "# Project notes",
      active: true,
    });
    expect(files["/index.html"]).toMatchObject({
      hidden: true,
    });
    expect(files["/index.html"].code).toContain("does not contain an");
  });
});
