// Wordmark tests (v1.3 plan Task 8, spec §5): "NeoPhylo" in Inter 600,
// text color, with the brand icon at its left; the app header shows it.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Header } from "./Header";
import { Wordmark } from "./Wordmark";

afterEach(cleanup);

describe("Wordmark", () => {
  it("shows the NeoPhylo wordmark with the brand icon at its left", () => {
    render(<Wordmark />);
    expect(screen.getByText("NeoPhylo")).toBeTruthy();
    const img = document.querySelector<HTMLImageElement>(".wordmark img");
    expect(img).not.toBeNull();
    expect(img!.src).toContain("brand/icon.svg");
    // Icon precedes the text.
    expect(img!.compareDocumentPosition(img!.nextSibling!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("supports the sm size", () => {
    render(<Wordmark size="sm" />);
    expect(document.querySelector(".wordmark-sm")).not.toBeNull();
  });
});

describe("Header", () => {
  it("shows the wordmark", () => {
    render(
      <Header
        title="Lesson"
        toast={null}
        source="sandbox"
        onSelectMode={() => {}}
        currentLessonId={null}
        onPickLesson={() => {}}
        onOpenPhylipHelp={() => {}}
        theme="light"
        presenter={false}
        dispatch={() => {}}
        breakpoint="wide"
        drawerOpen={false}
      />,
    );
    expect(screen.getByText("NeoPhylo")).toBeTruthy();
  });
});
